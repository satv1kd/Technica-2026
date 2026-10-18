"""PVOO end to end on Solana devnet: engine -> chain service -> devnet.

Needs the database and a running chain service (npm run chain) with a funded
devnet authority. Skipped otherwise. Runs on a throwaway account and sells
back what it buys, so the real PVOO supply ends where it started.
"""

import os

import httpx
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

CHAIN_URL = os.getenv("CHAIN_URL", "http://localhost:8001")


def chain_up() -> bool:
    try:
        return httpx.get(f"{CHAIN_URL}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = [
    pytest.mark.db,
    pytest.mark.devnet,
    pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="DATABASE_URL not set"),
    pytest.mark.skipif(not chain_up(), reason=f"chain service not running at {CHAIN_URL}"),
]


@pytest.fixture(scope="module")
def client():
    pool = make_pool(load_settings())
    with pool.connection() as conn:
        account_id = str(conn.execute(
            "INSERT INTO accounts (name, cash) VALUES ('pytest-devnet', 10000) RETURNING id"
        ).fetchone()[0])
    prices = PriceStore(pool)
    registry = default_registry(prices, HttpChainClient(CHAIN_URL))
    ledger = Ledger(pool, account_id)
    with TestClient(create_app(Services(prices, registry, ledger, TradeDesk(registry, ledger)))) as c:
        yield c
    with pool.connection() as conn, conn.transaction():
        for table in ("trades", "learning_events", "positions"):
            conn.execute(f"DELETE FROM {table} WHERE account_id = %s", (account_id,))
        conn.execute("DELETE FROM accounts WHERE id = %s", (account_id,))
    pool.close()


def trade(client, side, qty):
    proposal = client.post("/propose", json={"side": side, "symbol": "PVOO", "qty": qty}).json()
    return client.post("/confirm", json={"id": proposal["id"]}).json()


def test_buy_mints_on_chain_and_sell_burns(client):
    before = client.get("/backing").json()
    assert before["matches"], before

    bought = trade(client, "buy", "1.5")
    st = bought["settlement"]
    assert st["kind"] == "onchain", st
    assert len(st["ref"]) > 60  # a base58 transaction signature
    assert st["explorer"] == f"https://explorer.solana.com/tx/{st['ref']}?cluster=devnet"
    assert 0 < st["settle_ms"] < 8000

    during = client.get("/backing").json()
    assert during["matches"] and during["supply"] == pytest.approx(before["supply"] + 1.5)

    sold = trade(client, "sell", "1.5")
    assert sold["settlement"]["kind"] == "onchain"
    after = client.get("/backing").json()
    assert after["matches"] and after["supply"] == pytest.approx(before["supply"])
