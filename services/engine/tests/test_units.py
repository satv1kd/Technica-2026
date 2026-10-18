import threading
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from backtest import NotEnoughHistory, backtest
from coaching import coaching_tip
from ledger import InsufficientFunds, InsufficientShares, TradeRecord
from markets import MarketRegistry, UnknownSymbol, default_registry
from markets.equity import EquityMarket
from prices import Close, market_open, price_note, range_start, UnknownRange
from trades import InvalidOrder, NoProposal, ProposalExpired, TradeDesk

from fakes import Clock, FakeChain, FakeLedger, FakePrices, daily

SATURDAY = datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc)  # 2pm New York
PRICES = {s: daily("2026-10-12", [100, 101, 102, 103, 104]) for s in
          ("VOO", "SPY", "QQQ", "AAPL", "MSFT", "NVDA")}


def make_desk(cash="10000", chain=None, clock=None):
    chain = chain or FakeChain()
    clock = clock or Clock(SATURDAY)
    prices = FakePrices(PRICES)
    registry = default_registry(prices, chain)
    ledger = FakeLedger(cash)
    return TradeDesk(registry, ledger, clock=clock), ledger, chain, clock


# Registry -------------------------------------------------------------------

def test_registry_has_six_equities_and_pvoo():
    registry = default_registry(FakePrices(PRICES), FakeChain())
    assert sorted(registry.symbols()) == ["AAPL", "MSFT", "NVDA", "PVOO", "QQQ", "SPY", "VOO"]


def test_registry_rejects_a_symbol_claimed_twice():
    prices = FakePrices(PRICES)
    with pytest.raises(ValueError):
        MarketRegistry([EquityMarket(prices), EquityMarket(prices)])


def test_unknown_symbol():
    desk, *_ = make_desk()
    with pytest.raises(UnknownSymbol):
        desk.propose("buy", "TSLA", 1)


# Two-step trades ------------------------------------------------------------

def test_propose_then_confirm_buys():
    desk, ledger, _, _ = make_desk()
    p = desk.propose("buy", "voo", 2)
    assert p.fill.total == Decimal("208.00")
    assert "Press Enter or say confirm" in p.readback
    assert ledger.cash() == Decimal(10000)  # nothing happens on propose

    result = desk.confirm(p.id)
    assert ledger.cash() == Decimal("9792.00")
    assert ledger.position("VOO").quantity == 2
    assert result.settlement.kind == "T+1"


def test_confirm_twice_fails_the_second_time():
    desk, *_ = make_desk()
    p = desk.propose("buy", "VOO", 1)
    desk.confirm(p.id)
    with pytest.raises(NoProposal):
        desk.confirm(p.id)


def test_confirm_without_a_proposal():
    desk, *_ = make_desk()
    with pytest.raises(NoProposal):
        desk.confirm("nope")


def test_proposal_expires_after_60_seconds():
    desk, ledger, _, clock = make_desk()
    p = desk.propose("buy", "VOO", 1)
    clock.advance(59)
    p2 = desk.propose("buy", "VOO", 1)
    desk.confirm(p2.id)  # still live at 59 s
    clock.advance(1)
    with pytest.raises(ProposalExpired):
        desk.confirm(p.id)
    assert ledger.position("VOO").quantity == 1


def test_cancel_removes_the_proposal():
    desk, ledger, *_ = make_desk()
    p = desk.propose("buy", "VOO", 1)
    desk.cancel(p.id)
    with pytest.raises(NoProposal):
        desk.confirm(p.id)
    assert ledger.cash() == Decimal(10000)


def test_concurrent_confirms_execute_once():
    desk, ledger, *_ = make_desk()
    p = desk.propose("buy", "VOO", 1)
    outcomes = []

    def go():
        try:
            desk.confirm(p.id)
            outcomes.append("ok")
        except NoProposal:
            outcomes.append("no")

    threads = [threading.Thread(target=go) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert outcomes.count("ok") == 1
    assert ledger.position("VOO").quantity == 1


def test_insufficient_funds_is_caught_at_propose():
    desk, *_ = make_desk(cash="100")
    with pytest.raises(InsufficientFunds) as e:
        desk.propose("buy", "VOO", 1)
    assert "practice cash" in str(e.value)


def test_cannot_sell_what_you_do_not_own():
    desk, *_ = make_desk()
    with pytest.raises(InsufficientShares):
        desk.propose("sell", "VOO", 1)


@pytest.mark.parametrize("qty", [0, -1, "abc", "NaN", 10_001])
def test_bad_quantities(qty):
    desk, *_ = make_desk()
    with pytest.raises(InvalidOrder):
        desk.propose("buy", "VOO", qty)


def test_equities_need_whole_shares_but_pvoo_is_fractional():
    desk, ledger, *_ = make_desk()
    with pytest.raises(InvalidOrder, match="whole shares"):
        desk.propose("buy", "VOO", "1.5")
    p = desk.propose("buy", "PVOO", "0.37")
    desk.confirm(p.id)
    assert ledger.position("PVOO").quantity == Decimal("0.37")
    with pytest.raises(InvalidOrder, match="decimal places"):
        desk.propose("buy", "PVOO", "0.0000001")


def test_bad_side():
    desk, *_ = make_desk()
    with pytest.raises(InvalidOrder):
        desk.propose("short", "VOO", 1)


# PVOO settlement ------------------------------------------------------------

def test_pvoo_mirrors_voo_and_mints_on_chain():
    desk, ledger, chain, _ = make_desk()
    p = desk.propose("buy", "PVOO", 2)
    assert p.fill.price == Decimal("104")  # VOO's last close
    result = desk.confirm(p.id)
    assert result.settlement.kind == "onchain"
    assert result.settlement.ref == "sig-mint-1"
    assert "explorer.solana.com" in result.settlement.extra["explorer"]
    assert chain.calls == [("mint", Decimal(2))]

    sell = desk.propose("sell", "PVOO", 1)
    desk.confirm(sell.id)
    assert chain.calls[-1] == ("burn", Decimal(1))


def test_pvoo_falls_back_to_simulated_settlement():
    desk, ledger, *_ = make_desk(chain=FakeChain(fail=True))
    p = desk.propose("buy", "PVOO", 2)
    result = desk.confirm(p.id)
    assert result.settlement.kind == "simulated"
    assert "ledger only" in result.settlement.note
    assert ledger.position("PVOO").quantity == 2  # the trade still filled


# Market hours ---------------------------------------------------------------

def test_market_hours():
    assert not market_open(SATURDAY)
    assert market_open(datetime(2026, 10, 14, 14, 0, tzinfo=timezone.utc))  # Wed 10am NY
    assert not market_open(datetime(2026, 10, 14, 13, 0, tzinfo=timezone.utc))  # 9am NY
    assert not market_open(datetime(2026, 10, 14, 20, 0, tzinfo=timezone.utc))  # 4pm NY
    assert not market_open(datetime(2026, 11, 26, 16, 0, tzinfo=timezone.utc))  # Thanksgiving


def test_weekend_quote_says_it_is_fridays_close():
    note = price_note(SATURDAY, date(2026, 10, 16))
    assert note == "The market is closed, so this is the last closing price, from Friday, October 16."


def test_range_start():
    assert range_start("1m", date(2026, 10, 16)) == date(2026, 9, 15)
    assert range_start("2025-01-02", date(2026, 10, 16)) == date(2025, 1, 2)
    with pytest.raises(UnknownRange):
        range_start("forever", date(2026, 10, 16))


# Backtest -------------------------------------------------------------------

def test_backtest_return_and_drawdown():
    closes = [Close(date(2026, 1, d), Decimal(c)) for d, c in
              [(1, 100), (2, 120), (3, 90), (4, 110), (5, 150)]]
    r = backtest("VOO", closes, Decimal(1000))
    assert r.end_value == Decimal("1500.00")
    assert r.return_pct == Decimal("50.0")
    assert r.max_drawdown_pct == Decimal("-25.0")  # 120 -> 90
    assert r.drawdown_peak_date == date(2026, 1, 2)
    assert r.drawdown_trough_date == date(2026, 1, 3)


def test_backtest_that_only_rises_has_no_drawdown():
    closes = [Close(date(2026, 1, d), Decimal(100 + d)) for d in range(1, 6)]
    assert backtest("VOO", closes, Decimal(1000)).max_drawdown_pct == 0


def test_backtest_needs_history():
    with pytest.raises(NotEnoughHistory):
        backtest("VOO", [Close(date(2026, 1, 1), Decimal(1))], Decimal(1000))


# Coaching -------------------------------------------------------------------

def _trade(side="buy", symbol="VOO", price="100", meta=None, when=SATURDAY):
    return TradeRecord("t", when, symbol, "equity", side, Decimal(1), Decimal(price), "T+1", None, meta or {})


def test_tip_only_every_third_trade():
    assert coaching_tip({}, [_trade()] * 2, SATURDAY) is None
    assert coaching_tip({}, [_trade()] * 3, SATURDAY) is not None


def test_tip_flags_concentration():
    tip = coaching_tip({"NVDA": Decimal("0.6")}, [_trade()] * 3, SATURDAY)
    assert "NVDA" in tip and "diversification" in tip


def test_tip_flags_frequent_trading():
    assert "trades in the last day" in coaching_tip({}, [_trade()] * 6, SATURDAY)


def test_tip_flags_selling_after_a_dip():
    trades = [_trade("sell", price="90", meta={"avg_cost": "100"}), _trade(), _trade()]
    assert "locks in the loss" in coaching_tip({}, trades, SATURDAY)
