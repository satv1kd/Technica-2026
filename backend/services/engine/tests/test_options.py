import math
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from markets import UnknownSymbol, default_registry
from markets.options import (
    MULTIPLIER, InvalidContract, OptionsMarket, black_scholes, contract_symbol, parse_contract, realized_vol,
)
from trades import TradeDesk

from fakes import Clock, FakeChain, FakeLedger, FakePrices, daily

SATURDAY = datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc)
# A year of AAPL closes ending Friday 2026-10-16 at 100, moving 1% a day
# (about 16% annualized volatility).
CLOSES = [100.0 if i % 2 == 0 else 101.0 for i in range(365)]
PRICES = {"AAPL": daily("2025-10-17", CLOSES), "VOO": daily("2026-10-12", [500] * 5)}
CALL = "AAPL-C-100-20261120"
PUT = "AAPL-P-100-20261120"


def setup(cash="10000"):
    prices = FakePrices(PRICES)
    registry = default_registry(prices, FakeChain())
    ledger = FakeLedger(cash)
    return TradeDesk(registry, ledger, clock=Clock(SATURDAY)), ledger, registry


# Pricing ---------------------------------------------------------------------

def test_black_scholes_matches_a_textbook_value():
    # Hull's example: S=42, K=40, r=10%, sigma=20%, T=0.5 -> call 4.76, put 0.81.
    assert black_scholes("call", 42, 40, 0.5, 0.2, 0.1) == pytest.approx(4.76, abs=0.01)
    assert black_scholes("put", 42, 40, 0.5, 0.2, 0.1) == pytest.approx(0.81, abs=0.01)


def test_put_call_parity():
    s, k, t, v, r = 100, 105, 0.25, 0.3, 0.04
    c, p = black_scholes("call", s, k, t, v, r), black_scholes("put", s, k, t, v, r)
    assert c - p == pytest.approx(s - k * math.exp(-r * t), abs=1e-9)


def test_expired_contracts_are_worth_their_intrinsic_value():
    assert black_scholes("call", 120, 100, 0, 0.3) == 20
    assert black_scholes("put", 120, 100, 0, 0.3) == 0


def test_realized_vol_uses_the_stocks_own_history():
    flat = [100.0] * 50
    assert realized_vol(flat) == 0
    assert realized_vol([100.0] * 5) == 0.25  # too little data: default
    assert realized_vol(CLOSES) == pytest.approx(0.01 * math.sqrt(252), rel=0.02)


def test_quotes_are_per_contract_and_reasonable():
    _, _, registry = setup()
    market = registry.market(CALL)
    assert isinstance(market, OptionsMarket)
    q = market.option_quote(CALL)
    assert q.days_left == 35 and q.spot == Decimal("100.00")
    # At the money, a month out: a few dollars a share.
    assert Decimal("0.50") < q.premium < Decimal("10")
    assert market.quote(CALL).price == q.premium * MULTIPLIER
    assert q.breakeven == Decimal(100) + q.premium
    assert q.max_gain is None  # a call's upside is unlimited
    put = market.option_quote(PUT)
    assert put.breakeven == Decimal(100) - put.premium
    assert put.max_gain == (Decimal(100) - put.premium) * MULTIPLIER


def test_payoff_is_a_hockey_stick():
    _, _, registry = setup()
    q = registry.market(CALL).option_quote(CALL)
    flat = [q.profit_at_expiry(Decimal(p)) for p in (50, 80, 100)]
    assert flat == [-q.contract_cost] * 3  # below the strike: lose the premium, no more
    assert q.profit_at_expiry(q.breakeven) == 0
    assert q.profit_at_expiry(Decimal(120)) - q.profit_at_expiry(Decimal(110)) == 10 * MULTIPLIER


# Contract names ------------------------------------------------------------

def test_contract_symbols():
    assert contract_symbol("aapl", "call", 350, "2026-11-20") == "AAPL-C-350-20261120"
    assert contract_symbol("MSFT", "put", "412.50", date(2027, 1, 15)) == "MSFT-P-412.5-20270115"
    assert parse_contract("AAPL-C-350.00-20261120").symbol == "AAPL-C-350-20261120"


@pytest.mark.parametrize("bad", ["PVOO-C-100-20261120", "TSLA-C-100-20261120", "AAPL-C-0-20261120",
                                 "AAPL-C-100-20261340"])
def test_bad_contracts(bad):
    with pytest.raises(InvalidContract):
        parse_contract(bad)


def test_registry_still_rejects_unknown_symbols():
    _, _, registry = setup()
    with pytest.raises(UnknownSymbol):
        registry.market("AAPL-X-1")


# Trading ---------------------------------------------------------------------

def test_buy_then_sell_a_call():
    desk, ledger, _ = setup()
    p = desk.propose("buy", "AAPL-C-100.0-20261120", 2)
    assert p.fill.symbol == CALL
    assert p.readback.startswith("Buy 2 AAPL call contracts, strike 100 dollars, expiring November 20, at ")
    assert "Most beginners lose money on options" in p.readback
    result = desk.confirm(p.id)
    assert result.settlement.kind == "T+1"
    assert ledger.cash() == Decimal("10000") - p.fill.total

    sold = desk.confirm(desk.propose("sell", CALL, 2).id)
    assert sold.trade.side == "sell"
    assert ledger.cash() == Decimal("10000")


def test_cannot_write_options_you_do_not_own():
    from ledger import InsufficientShares
    desk, *_ = setup()
    with pytest.raises(InsufficientShares):
        desk.propose("sell", PUT, 1)


def test_whole_contracts_only():
    from trades import InvalidOrder
    desk, *_ = setup()
    with pytest.raises(InvalidOrder):
        desk.propose("buy", CALL, "0.5")


def test_expired_and_far_contracts_cannot_be_bought():
    desk, *_ = setup()
    with pytest.raises(InvalidContract, match="expired"):
        desk.propose("buy", "AAPL-C-100-20261016", 1)
    with pytest.raises(InvalidContract, match="two years"):
        desk.propose("buy", "AAPL-C-100-20291016", 1)


# API -------------------------------------------------------------------------

def test_options_quote_endpoint():
    from fastapi.testclient import TestClient
    from api import Services, create_app

    desk, ledger, registry = setup()
    svc = Services(FakePrices(PRICES), registry, ledger, desk, clock=desk.clock)
    with TestClient(create_app(svc)) as client:
        by_parts = client.get("/options/quote", params={
            "underlying": "aapl", "type": "call", "strike": 100, "expiry": "2026-11-20"}).json()
        assert by_parts["symbol"] == CALL
        assert by_parts["max_loss"] == by_parts["contract_cost"]
        assert by_parts["max_gain"] is None
        profits = [p["profit"] for p in by_parts["payoff_at_expiry"]]
        assert profits[0] == -by_parts["contract_cost"] and profits[-1] > 0
        assert "The most you can lose" in by_parts["spoken"]

        r = client.get("/options/quote", params={"symbol": "AAPL-C-100-20261340"})
        assert r.status_code == 422 and r.json()["error"] == "invalid_contract"
        assert client.get("/options/quote").status_code == 422

        markets = client.get("/markets").json()["markets"]
        assert {"symbol": "options"}.items() <= next(m for m in markets if m["symbol"] == "options").items()
