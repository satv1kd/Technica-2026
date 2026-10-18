"""Sonar trading engine: a practice brokerage over REST.

Knows nothing about Gemini, voice, or the arm. Run from services/engine:

    .venv/Scripts/python -m uvicorn api:app --port 8000
"""

from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backtest import NotEnoughHistory, backtest
from ledger import InsufficientFunds, InsufficientShares, LedgerStore, TradeRecord
from markets import MarketRegistry, NoPriceData, UnknownSymbol
from portfolio import STARTING_CASH, summarize
from prices import PriceSource, UnknownRange, market_open, price_note, range_start
from trades import InvalidOrder, NoProposal, Proposal, ProposalExpired, TradeDesk, utcnow


@dataclass
class Services:
    prices: PriceSource
    registry: MarketRegistry
    ledger: LedgerStore
    desk: TradeDesk
    clock: Callable[[], datetime] = utcnow
    close: Callable[[], None] = lambda: None


def build_services() -> Services:
    from config import load_settings
    from db import make_pool, resolve_account
    from ledger import Ledger
    from markets import default_registry
    from markets.pvoo import HttpChainClient
    from prices import PriceStore

    settings = load_settings()
    pool = make_pool(settings)
    prices = PriceStore(pool)
    registry = default_registry(prices, HttpChainClient(settings.chain_url))
    ledger = Ledger(pool, resolve_account(pool, settings.account_id))
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
        return {"ok": True, "market_open": market_open(s.clock()), "symbols": len(s.registry.symbols())}

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

    @app.get("/review")
    def review(request: Request, limit: int = Query(50, ge=1, le=500)):
        return {"trades": [trade_json(t) for t in svc(request).ledger.trades(limit)]}

    return app


app = create_app()
