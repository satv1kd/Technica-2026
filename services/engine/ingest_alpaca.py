"""Load daily bars from Alpaca's market data API into the prices hypertable.

    .venv/Scripts/python ingest_alpaca.py --backfill   # 2 years, all symbols
    .venv/Scripts/python ingest_alpaca.py --refresh    # last 10 days
    .venv/Scripts/python ingest_alpaca.py --loop       # refresh every 15 min in market hours

Uses the free IEX feed. Upserts on (symbol, time), so reruns are safe.
"""

import argparse
import json
import logging
import os
import time
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta, timezone

import httpx
from psycopg_pool import ConnectionPool

from config import REPO_ROOT
from prices import market_open

SYMBOLS = ("VOO", "SPY", "QQQ", "AAPL", "MSFT", "NVDA")
BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"
SOURCE = "alpaca-iex"
REFRESH_EVERY_S = 15 * 60
STATE_FILE = REPO_ROOT / "data" / "ingest_state.json"

log = logging.getLogger("sonar.ingest")


class MissingAlpacaKeys(RuntimeError):
    pass


def alpaca_client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    key, secret = os.getenv("ALPACA_KEY_ID", "").strip(), os.getenv("ALPACA_SECRET_KEY", "").strip()
    if not key or not secret:
        raise MissingAlpacaKeys("Set ALPACA_KEY_ID and ALPACA_SECRET_KEY in .env to fetch prices.")
    return httpx.Client(
        headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret},
        timeout=30,
        transport=transport,
    )


def fetch_bars(client: httpx.Client, symbols: tuple[str, ...], start: date, end: date | None = None) -> Iterator[tuple]:
    """Yield (time, symbol, open, high, low, close, volume) rows, following pagination."""
    params = {
        "symbols": ",".join(symbols),
        "timeframe": "1Day",
        "start": start.isoformat(),
        "feed": "iex",
        "adjustment": "all",
        "limit": 10000,
    }
    if end:
        params["end"] = end.isoformat()
    token = None
    while True:
        r = client.get(BARS_URL, params={**params, **({"page_token": token} if token else {})})
        r.raise_for_status()
        body = r.json()
        for symbol, bars in (body.get("bars") or {}).items():
            for b in bars:
                ts = datetime.fromisoformat(b["t"].replace("Z", "+00:00"))
                yield ts, symbol, b["o"], b["h"], b["l"], b["c"], b["v"]
        token = body.get("next_page_token")
        if not token:
            return


def upsert(pool: ConnectionPool, rows: list[tuple]) -> int:
    if not rows:
        return 0
    with pool.connection() as conn, conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO prices (time, symbol, asset_class, open, high, low, close, volume, source)
               VALUES (%s, %s, 'equity', %s, %s, %s, %s, %s, %s)
               ON CONFLICT (symbol, time) DO UPDATE SET
                 open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                 close = EXCLUDED.close, volume = EXCLUDED.volume, source = EXCLUDED.source""",
            [(*r, SOURCE) for r in rows],
        )
    return len(rows)


def ingest(pool: ConnectionPool, client: httpx.Client, start: date, symbols=SYMBOLS) -> int:
    n = upsert(pool, list(fetch_bars(client, symbols, start)))
    save_state({"last_success": datetime.now(timezone.utc).isoformat(), "rows": n, "start": start.isoformat()})
    log.info("Upserted %d bars since %s", n, start)
    return n


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def load_state() -> dict:
    return json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}


def should_refresh(now: datetime, last_success: datetime | None) -> bool:
    """Refresh every 15 minutes while the market is open. Outside market hours
    (weekends, holidays, nights) the last close is already stored."""
    if not market_open(now):
        return False
    return last_success is None or now - last_success >= timedelta(seconds=REFRESH_EVERY_S)


def run_loop(pool: ConnectionPool, client: httpx.Client, clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
    while True:
        last = load_state().get("last_success")
        if should_refresh(clock(), datetime.fromisoformat(last) if last else None):
            try:
                ingest(pool, client, clock().date() - timedelta(days=10))
            except httpx.HTTPError as exc:
                log.warning("Alpaca refresh failed: %s", exc)
        time.sleep(60)


def main() -> None:
    from config import load_settings
    from db import make_pool

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--backfill", action="store_true")
    mode.add_argument("--refresh", action="store_true")
    mode.add_argument("--loop", action="store_true")
    args = ap.parse_args()

    pool = make_pool(load_settings())
    try:
        with alpaca_client() as client:
            if args.loop:
                run_loop(pool, client)
            days = 731 if args.backfill else 10
            ingest(pool, client, date.today() - timedelta(days=days))
    finally:
        pool.close()


if __name__ == "__main__":
    main()
