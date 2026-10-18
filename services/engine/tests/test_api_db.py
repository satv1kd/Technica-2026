"""API tests against the real Tiger Data database.

They run on a throwaway account created for this module and deleted at the
end, so the team's "Demo learner" account and price data are never touched.
The chain service points at a dead port, which exercises the real
ledger-only fallback for PVOO.
"""

import os
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import pytest
from fastapi.testclient import TestClient

from api import Services, create_app
from config import load_settings
from db import make_pool
from ledger import Ledger
from markets import default_registry
from markets.pvoo import HttpChainClient
from prices import PriceStore
from trades import TradeDesk

from fakes import Clock

pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="DATABASE_URL not set"),
]

SATURDAY = datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def env():
    pool = make_pool(load_settings())
    with pool.connection() as conn:
        account_id = str(conn.execute(
            "INSERT INTO accounts (name, cash) VALUES ('pytest-engine', 10000) RETURNING id"
        ).fetchone()[0])
    clock = Clock(SATURDAY)
    prices = PriceStore(pool)
    registry = default_registry(prices, HttpChainClient("http://127.0.0.1:9", timeout=1))
    ledger = Ledger(pool, account_id)
    services = Services(prices, registry, ledger, TradeDesk(registry, ledger, clock=clock), clock=clock)
    with TestClient(create_app(services)) as client:
        yield client, pool, account_id, clock
    with pool.connection() as conn, conn.transaction():
        for table in ("trades", "learning_events", "positions"):
            conn.execute(f"DELETE FROM {table} WHERE account_id = %s", (account_id,))
        conn.execute("DELETE FROM accounts WHERE id = %s", (account_id,))
    pool.close()


def q(pool, sql, *args):
    with pool.connection() as conn:
        return conn.execute(sql, args).fetchall()


def cash(pool, account_id) -> Decimal:
    return Decimal(q(pool, "SELECT cash FROM accounts WHERE id = %s", account_id)[0][0])


def buy(client, symbol, qty, side="buy"):
    p = client.post("/propose", json={"side": side, "symbol": symbol, "qty": qty})
    assert p.status_code == 200, p.text
    c = client.post("/confirm", json={"id": p.json()["id"]})
    assert c.status_code == 200, c.text
    return p.json(), c.json()


def test_health_and_markets(env):
    client, *_ = env
    assert client.get("/health").json()["market_open"] is False
    symbols = sorted(m["symbol"] for m in client.get("/markets").json()["markets"])
    assert symbols == ["AAPL", "MSFT", "NVDA", "PVOO", "QQQ", "SPY", "VOO"]


def test_quote_matches_the_database(env):
    client, pool, *_ = env
    (db_close, db_time), = q(pool, "SELECT close, time FROM prices WHERE symbol = 'VOO' ORDER BY time DESC LIMIT 1")
    body = client.get("/quote", params={"symbol": "voo"}).json()
    assert Decimal(str(body["price"])) == Decimal(str(db_close)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    assert body["market_open"] is False
    assert body["note"].startswith("The market is closed, so this is the last closing price")
    assert client.get("/quote", params={"symbol": "PVOO"}).json()["price"] == body["price"]


def test_unknown_symbol_is_404(env):
    client, *_ = env
    r = client.get("/quote", params={"symbol": "TSLA"})
    assert r.status_code == 404 and r.json()["error"] == "unknown_symbol"


def test_history(env):
    client, *_ = env
    pts = client.get("/history", params={"symbol": "AAPL", "range": "1m"}).json()["points"]
    assert 18 <= len(pts) <= 24
    assert [p["date"] for p in pts] == sorted(p["date"] for p in pts)
    assert client.get("/history", params={"symbol": "AAPL", "range": "zzz"}).status_code == 400


def test_buy_updates_cash_position_and_trade_log(env):
    client, pool, account_id, _ = env
    before = cash(pool, account_id)
    proposal, result = buy(client, "VOO", 2)

    assert "Press Enter or say confirm" in proposal["readback"]
    assert cash(pool, account_id) == before - Decimal(str(proposal["total"]))
    assert result["cash_after"] == float(cash(pool, account_id))
    assert result["settlement"]["kind"] == "T+1"

    (qty,), = q(pool, "SELECT quantity FROM positions WHERE account_id = %s AND symbol = 'VOO'", account_id)
    assert qty == 2
    (settlement,), = q(pool, "SELECT settlement FROM trades WHERE id = %s", proposal["id"])
    assert settlement == "T+1"
    events = q(pool, "SELECT detail->>'trade_id' FROM learning_events WHERE account_id = %s AND kind = 'trade'", account_id)
    assert (proposal["id"],) in events


def test_confirm_twice_or_without_proposal_is_409(env):
    client, *_ = env
    proposal, _ = buy(client, "VOO", 1)
    again = client.post("/confirm", json={"id": proposal["id"]})
    assert again.status_code == 409 and again.json()["error"] == "no_proposal"
    assert client.post("/confirm", json={"id": "does-not-exist"}).status_code == 409


def test_expired_proposal_is_409_and_changes_nothing(env):
    client, pool, account_id, clock = env
    p = client.post("/propose", json={"side": "buy", "symbol": "VOO", "qty": 1}).json()
    before = cash(pool, account_id)
    clock.advance(61)
    r = client.post("/confirm", json={"id": p["id"]})
    assert r.status_code == 409 and r.json()["error"] == "proposal_expired"
    assert "expired" in r.json()["message"]
    assert cash(pool, account_id) == before


def test_cancel(env):
    client, *_ = env
    p = client.post("/propose", json={"side": "buy", "symbol": "SPY", "qty": 1}).json()
    assert client.post("/cancel", json={"id": p["id"]}).status_code == 200
    assert client.post("/confirm", json={"id": p["id"]}).status_code == 409


def test_insufficient_funds_at_propose(env):
    client, *_ = env
    r = client.post("/propose", json={"side": "buy", "symbol": "NVDA", "qty": 1000})
    assert r.status_code == 422 and r.json()["error"] == "insufficient_funds"


def test_cash_dropping_between_propose_and_confirm_blocks_the_trade(env):
    """The ledger re-checks atomically, so cash can never go negative."""
    client, pool, account_id, _ = env
    p = client.post("/propose", json={"side": "buy", "symbol": "VOO", "qty": 5}).json()
    original = cash(pool, account_id)
    trades_before = q(pool, "SELECT count(*) FROM trades WHERE account_id = %s", account_id)[0][0]
    pos_before = q(pool, "SELECT quantity FROM positions WHERE account_id = %s AND symbol = 'VOO'", account_id)
    try:
        q_exec(pool, "UPDATE accounts SET cash = 100 WHERE id = %s", account_id)
        r = client.post("/confirm", json={"id": p["id"]})
        assert r.status_code == 422 and r.json()["error"] == "insufficient_funds"
        assert cash(pool, account_id) == Decimal(100)
        assert q(pool, "SELECT count(*) FROM trades WHERE account_id = %s", account_id)[0][0] == trades_before
        assert q(pool, "SELECT quantity FROM positions WHERE account_id = %s AND symbol = 'VOO'", account_id) == pos_before
    finally:
        q_exec(pool, "UPDATE accounts SET cash = %s WHERE id = %s", original, account_id)


def q_exec(pool, sql, *args):
    with pool.connection() as conn:
        conn.execute(sql, args)


def test_sell_more_than_owned_is_422(env):
    client, *_ = env
    r = client.post("/propose", json={"side": "sell", "symbol": "MSFT", "qty": 1})
    assert r.status_code == 422 and r.json()["error"] == "insufficient_shares"


def test_sell_returns_cash_and_records_realized_gain(env):
    client, pool, account_id, _ = env
    buy(client, "QQQ", 2)
    before = cash(pool, account_id)
    proposal, result = buy(client, "QQQ", 1, side="sell")
    assert cash(pool, account_id) == before + Decimal(str(proposal["total"]))
    assert "realized_gain" in result["trade"]["metadata"]
    (qty,), = q(pool, "SELECT quantity FROM positions WHERE account_id = %s AND symbol = 'QQQ'", account_id)
    assert qty == 1
    buy(client, "QQQ", 1, side="sell")
    assert q(pool, "SELECT 1 FROM positions WHERE account_id = %s AND symbol = 'QQQ'", account_id) == []


def test_fractional_rules(env):
    client, pool, account_id, _ = env
    r = client.post("/propose", json={"side": "buy", "symbol": "VOO", "qty": "1.5"})
    assert r.status_code == 422 and "whole shares" in r.json()["message"]
    proposal, result = buy(client, "PVOO", "0.5")
    # The chain service is down in this test, so it falls back to the ledger.
    assert result["settlement"]["kind"] == "simulated"
    (qty, settlement), = q(pool, "SELECT quantity, settlement FROM trades WHERE id = %s", proposal["id"])
    assert qty == Decimal("0.5") and settlement == "simulated"


def test_backtest_matches_an_independent_calculation(env):
    client, pool, *_ = env
    body = client.post("/backtest", json={"symbol": "VOO", "amount": 1000, "start": "1y"}).json()
    rows = q(pool, "SELECT close FROM prices WHERE symbol = 'VOO' AND time >= %s ORDER BY time",
             datetime.fromisoformat(body["start_date"] + "T00:00:00-04:00"))
    first, last = rows[0][0], rows[-1][0]
    assert body["end_value"] == pytest.approx(1000 * last / first, abs=0.05)
    peak, worst = first, 0.0
    for (c,) in rows:
        peak = max(peak, c)
        worst = min(worst, (c - peak) / peak)
    assert body["max_drawdown_pct"] == pytest.approx(worst * 100, abs=0.06)
    assert body["max_drawdown_pct"] <= 0


def test_portfolio_adds_up(env):
    client, pool, account_id, _ = env
    p = client.get("/portfolio").json()
    assert p["cash"] == float(cash(pool, account_id))
    assert p["total_value"] == pytest.approx(p["cash"] + sum(h["value"] for h in p["holdings"]), abs=0.01)
    assert p["trade_count"] == q(pool, "SELECT count(*) FROM trades WHERE account_id = %s", account_id)[0][0]
    assert (p["tip"] is not None) == (p["trade_count"] % 3 == 0)


def test_review_lists_trades_newest_first(env):
    client, *_ = env
    trades = client.get("/review").json()["trades"]
    assert len(trades) >= 3
    times = [t["time"] for t in trades]
    assert times == sorted(times, reverse=True)
