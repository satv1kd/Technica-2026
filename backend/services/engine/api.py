"""Sonar trading engine: a practice brokerage over REST.

Knows nothing about Gemini, voice, or the arm. Run from services/engine:

    .venv/Scripts/python -m uvicorn api:app --port 8000
"""

import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backtest import NotEnoughHistory, backtest
from fallback import DB_DOWN, CsvPriceSource, DatabaseUnavailable, FallbackPriceSource, OfflineLedger
from ledger import InsufficientFunds, InsufficientShares, LedgerStore, TradeRecord
from markets import MarketRegistry, NoPriceData, UnknownSymbol
from markets.options import InvalidContract, MULTIPLIER, contract_symbol
from markets.pvoo import ChainUnavailable
from portfolio import STARTING_CASH, summarize
from series import MAX_POINTS, MIN_POINTS, chart_series
from prices import PriceSource, UnknownRange, market_open, price_note, range_start
from trades import InvalidOrder, NoProposal, Proposal, ProposalExpired, TradeDesk, utcnow

log = logging.getLogger("sonar.engine")


@dataclass
class Services:
    prices: PriceSource
    registry: MarketRegistry
    ledger: LedgerStore
    desk: TradeDesk
    clock: Callable[[], datetime] = utcnow
    close: Callable[[], None] = lambda: None
    # True when the engine started without a database: prices come from CSV
    # and the account endpoints answer 503.
    offline: bool = False


def offline_services(chain) -> Services:
    from markets import default_registry

    prices = CsvPriceSource()
    registry = default_registry(prices, chain)
    ledger = OfflineLedger()
    return Services(prices, registry, ledger, TradeDesk(registry, ledger), offline=True)


def build_services() -> Services:
    from config import load_settings
    from db import make_pool, resolve_account
    from ledger import Ledger
    from markets import default_registry
    from markets.pvoo import HttpChainClient
    from prices import PriceStore

    settings = load_settings()
    chain = HttpChainClient(settings.chain_url)
    try:
        pool = make_pool(settings, timeout=10)
    except DB_DOWN as exc:
        log.warning("Database unreachable at startup (%s); serving prices from CSV, "
                    "account endpoints offline", type(exc).__name__)
        return offline_services(chain)
    try:
        account_id = resolve_account(pool, settings.account_id)
    except BaseException:
        pool.close()
        raise
    # Quotes, history, and backtests keep working from CSV if the database drops.
    prices = FallbackPriceSource(PriceStore(pool), CsvPriceSource())
    registry = default_registry(prices, chain)
    ledger = Ledger(pool, account_id)
    return Services(prices, registry, ledger, TradeDesk(registry, ledger), close=pool.close)


# JSON helpers ---------------------------------------------------------------

def money(d: Decimal) -> float:
    return float(d.quantize(Decimal("0.01"), ROUND_HALF_UP))


def num(d: Decimal) -> float:
    return float(d)


def proposal_json(p: Proposal) -> dict:
    f = p.fill
    return {
        "id": p.id, "side": f.side, "symbol": f.symbol, "asset_class": f.asset_class,
        "quantity": num(f.quantity), "price": money(f.price), "total": money(f.total),
        "price_as_of": p.as_of, "price_note": p.price_note, "risk_note": p.risk_note,
        "expires_at": p.expires_at.isoformat(), "readback": p.readback,
    }


def trade_json(t: TradeRecord) -> dict:
    return {
        "id": t.id, "time": t.time.isoformat(), "side": t.side, "symbol": t.symbol,
        "asset_class": t.asset_class, "quantity": num(t.quantity), "price": money(t.price),
        "total": money(t.total), "settlement": t.settlement, "settlement_ref": t.settlement_ref,
        "metadata": t.metadata,
    }


# Request bodies -------------------------------------------------------------

class ProposeBody(BaseModel):
    side: str
    symbol: str
    # A string keeps decimal precision for token amounts like "0.37".
    qty: str | float | int


class IdBody(BaseModel):
    id: str


class BacktestBody(BaseModel):
    symbol: str
    amount: float = Field(gt=0, le=1_000_000)
    start: str = "1y"


# App ------------------------------------------------------------------------

ERRORS: list[tuple[type[Exception], int, str]] = [
    (UnknownSymbol, 404, "unknown_symbol"),
    (NoProposal, 409, "no_proposal"),
    (ProposalExpired, 409, "proposal_expired"),
    (InsufficientFunds, 422, "insufficient_funds"),
    (InsufficientShares, 422, "insufficient_shares"),
    (InvalidOrder, 422, "invalid_order"),
    (UnknownRange, 400, "bad_range"),
    (NotEnoughHistory, 422, "not_enough_history"),
    (NoPriceData, 503, "no_price_data"),
    (InvalidContract, 422, "invalid_contract"),
    (DatabaseUnavailable, 503, "database_unavailable"),
    *((t, 503, "database_unavailable") for t in DB_DOWN),
]


def create_app(services: Services | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.svc = services or build_services()
        try:
            yield
        finally:
            app.state.svc.close()

    app = FastAPI(title="Sonar trading engine", lifespan=lifespan)

    for exc_type, status, code in ERRORS:
        def handler(_: Request, exc: Exception, status=status, code=code):
            return JSONResponse(status_code=status, content={"error": code, "message": str(exc)})
        app.add_exception_handler(exc_type, handler)

    def svc(request: Request) -> Services:
        return request.app.state.svc

    @app.get("/health")
    def health(request: Request):
        s = svc(request)
        return {
            "ok": True, "market_open": market_open(s.clock()), "symbols": len(s.registry.symbols()),
            "prices": "csv" if s.offline else "database",
            "csv_fallbacks": getattr(s.prices, "fallback_count", 0),
            "account": "offline" if s.offline else "online",
        }

    @app.get("/markets")
    def markets(request: Request):
        return {"markets": svc(request).registry.describe()}

    @app.get("/quote")
    def quote(request: Request, symbol: str):
        s = svc(request)
        q = s.registry.market(symbol).quote(symbol.upper())
        now = s.clock()
        return {
            "symbol": q.symbol, "asset_class": q.asset_class, "price": money(q.price),
            "as_of": q.as_of.isoformat(), "market_open": market_open(now),
            "note": price_note(now, q.as_of),
        }

    @app.get("/options/quote")
    def option_quote(
        request: Request,
        symbol: str | None = None,
        underlying: str | None = None,
        type: str | None = None,
        strike: float | None = None,
        expiry: str | None = None,
    ):
        """Price one contract, by symbol or by parts, with what it means for the learner."""
        if not symbol:
            if not (underlying and type and strike and expiry):
                raise InvalidContract("Give a contract symbol, or underlying, type, strike, and expiry.")
            symbol = contract_symbol(underlying, type, strike, expiry)
        s = svc(request)
        q = s.registry.market(symbol).option_quote(symbol)
        c = q.contract
        # Profit at expiry across a range of stock prices: the hockey stick.
        lo, hi = c.strike * Decimal("0.7"), c.strike * Decimal("1.3")
        payoff = [
            {"price": money(p), "profit": money(q.profit_at_expiry(p))}
            for p in (lo + (hi - lo) * i / 12 for i in range(13))
        ]
        return {
            "symbol": c.symbol, "underlying": c.underlying, "type": c.kind,
            "strike": num(c.strike), "expiry": c.expiry.isoformat(), "days_left": q.days_left,
            "underlying_price": money(q.spot), "as_of": q.as_of.isoformat(),
            "premium_per_share": money(q.premium), "contract_size": MULTIPLIER,
            "contract_cost": money(q.contract_cost), "breakeven": money(q.breakeven),
            "max_loss": money(q.contract_cost),
            "max_gain": None if q.max_gain is None else money(q.max_gain),
            "volatility_pct": round(q.vol * 100, 1),
            "payoff_at_expiry": payoff,
            "spoken": (
                f"One {c.spoken()}, costs {money(q.premium):,.2f} dollars a share, so "
                f"{money(q.contract_cost):,.2f} dollars for the contract of {MULTIPLIER} shares. "
                f"The most you can lose is that {money(q.contract_cost):,.2f} dollars. "
                f"At expiry the stock must be "
                f"{'above' if c.kind == 'call' else 'below'} {money(q.breakeven):,.2f} dollars to make money."
            ),
            "warning": "Most beginners lose money on options. Use practice money only.",
        }

    @app.get("/history")
    def history(request: Request, symbol: str, range: str = Query("1m")):
        s = svc(request)
        symbol = symbol.upper()
        market = s.registry.market(symbol)
        # PVOO mirrors VOO, so its history is VOO's.
        source = "VOO" if market.asset_class == "tokenized" else symbol
        latest = s.prices.latest(source)
        if latest is None:
            raise NoPriceData(f"No stored prices for {source}.")
        closes = s.prices.closes(source, range_start(range, latest.day))
        return {
            "symbol": symbol, "range": range,
            "points": [{"date": c.day.isoformat(), "close": money(c.close)} for c in closes],
        }

    @app.get("/chart")
    def chart(
        request: Request,
        symbols: str,
        range: str = Query("1m"),
        points: int = Query(12, ge=MIN_POINTS, le=MAX_POINTS),
    ):
        """Palm-ready drawing. Pass two symbols (AAPL,VOO) to compare on one scale."""
        s = svc(request)
        names = [x.strip().upper() for x in symbols.split(",") if x.strip()][:2]
        data = {}
        for name in names:
            market = s.registry.market(name)
            source = "VOO" if market.asset_class == "tokenized" else name
            latest = s.prices.latest(source)
            if latest is None:
                raise NoPriceData(f"No stored prices for {source}.")
            closes = s.prices.closes(source, range_start(range, latest.day))
            data[name] = [(c.day, c.close) for c in closes]
        series_list, (lo, hi) = chart_series(data, range, points)
        return {
            "range": range,
            "scale": {"low": lo, "high": hi},
            "series": [
                {
                    "symbol": x.symbol,
                    "smoothing": f"sma{x.smooth_window}" if x.smooth_window > 1 else "none",
                    "points": [{"x": p.x, "y": p.y, "date": p.day.isoformat(), "value": p.value}
                               for p in x.points],
                    "markers": x.markers,
                    "summary": {
                        "direction": x.direction,
                        "pct_change": round(x.pct_change, 1),
                        "first_close": round(x.first_close, 2),
                        "last_close": round(x.last_close, 2),
                        "raw_peak": {"date": x.raw_peak[0].isoformat(), "close": round(x.raw_peak[1], 2)},
                        "raw_trough": {"date": x.raw_trough[0].isoformat(), "close": round(x.raw_trough[1], 2)},
                    },
                }
                for x in series_list
            ],
        }

    @app.post("/propose")
    def propose(request: Request, body: ProposeBody):
        return proposal_json(svc(request).desk.propose(body.side, body.symbol, body.qty))

    @app.post("/confirm")
    def confirm(request: Request, body: IdBody):
        s = svc(request)
        result = s.desk.confirm(body.id)
        st = result.settlement
        return {
            "trade": trade_json(result.trade),
            "settlement": {"kind": st.kind, "ref": st.ref, "settle_ms": st.settle_ms,
                           "note": st.note, **st.extra},
            "cash_after": money(result.cash_after),
        }

    @app.post("/cancel")
    def cancel(request: Request, body: IdBody):
        p = svc(request).desk.cancel(body.id)
        return {"cancelled": p.id}

    @app.get("/portfolio")
    def portfolio(request: Request):
        s = svc(request)
        p = summarize(s.ledger, s.registry, s.clock())
        weights = p.weights()
        return {
            "cash": money(p.cash),
            "holdings": [
                {"symbol": h.symbol, "asset_class": h.asset_class, "quantity": num(h.quantity),
                 "avg_cost": money(h.avg_cost), "price": money(h.price), "price_as_of": h.as_of,
                 "value": money(h.value), "gain": money(h.gain),
                 "weight": round(float(weights.get(h.symbol, 0)), 4)}
                for h in p.holdings
            ],
            "invested": money(p.invested),
            "total_value": money(p.total_value),
            "starting_cash": money(STARTING_CASH),
            "total_gain": money(p.total_gain),
            "trade_count": p.trade_count,
            "tip": p.tip,
        }

    @app.post("/backtest")
    def run_backtest(request: Request, body: BacktestBody):
        s = svc(request)
        symbol = body.symbol.upper()
        market = s.registry.market(symbol)
        source = "VOO" if market.asset_class == "tokenized" else symbol
        latest = s.prices.latest(source)
        if latest is None:
            raise NoPriceData(f"No stored prices for {source}.")
        closes = s.prices.closes(source, range_start(body.start, latest.day))
        r = backtest(symbol, closes, Decimal(str(body.amount)))
        return {
            "symbol": r.symbol, "amount": money(r.amount),
            "start_date": r.start_date.isoformat(), "start_price": money(r.start_price),
            "end_date": r.end_date.isoformat(), "end_price": money(r.end_price),
            "end_value": money(r.end_value), "return_pct": float(r.return_pct),
            "max_drawdown_pct": float(r.max_drawdown_pct),
            "drawdown_peak_date": r.drawdown_peak_date.isoformat(),
            "drawdown_trough_date": r.drawdown_trough_date.isoformat(),
            "note": "This shows what happened in the past, not what will happen.",
        }

    @app.get("/backing")
    def backing(request: Request):
        """Is every PVOO on Sonar's ledger backed by a token on chain?"""
        s = svc(request)
        market = s.registry.market("PVOO")
        onchain_ledger, simulated = s.ledger.token_totals("PVOO")
        try:
            supply = market.chain.supply()
        except ChainUnavailable as exc:
            return JSONResponse(status_code=503, content={
                "error": "chain_unavailable", "message": str(exc),
                "ledger_onchain": num(onchain_ledger), "ledger_simulated": num(simulated),
            })
        matches = supply == onchain_ledger
        if matches:
            spoken = (f"Supply matches the ledger: {supply.normalize():f} tokens on chain, "
                      f"{onchain_ledger.normalize():f} on Sonar's ledger.")
        else:
            spoken = (f"Warning: {supply.normalize():f} tokens on chain, "
                      f"but the ledger says {onchain_ledger.normalize():f}.")
        if simulated:
            spoken += (f" Another {simulated.normalize():f} PVOO were simulated while devnet "
                       f"was down, so they are not on chain.")
        return {
            "supply": num(supply), "ledger_onchain": num(onchain_ledger),
            "ledger_simulated": num(simulated), "matches": matches, "spoken": spoken,
        }

    @app.get("/review")
    def review(request: Request, limit: int = Query(50, ge=1, le=500)):
        return {"trades": [trade_json(t) for t in svc(request).ledger.trades(limit)]}

    return app


app = create_app()
