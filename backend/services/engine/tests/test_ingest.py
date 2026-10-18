import logging
import os
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from psycopg_pool import ConnectionPool

import ingest_alpaca
from fallback import CsvPriceSource, FallbackPriceSource
from ingest_alpaca import MissingAlpacaKeys, alpaca_client, alpaca_key_id, fetch_bars, should_refresh, upsert
from prices import PriceStore

SATURDAY = datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc)
WED_11AM_NY = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)


def bar(day: str, close: float):
    return {"t": f"{day}T04:00:00Z", "o": close - 1, "h": close + 1, "l": close - 2, "c": close, "v": 100}


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("ALPACA_KEY_ID", "test-key")
    monkeypatch.setenv("ALPACA_SECRET_KEY", "test-secret")


def mock_alpaca(pages: list[dict], seen: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=pages[len(seen) - 1])
    return httpx.MockTransport(handler)


# Alpaca client --------------------------------------------------------------

def test_missing_keys_are_reported(monkeypatch):
    monkeypatch.setenv("ALPACA_KEY_ID", "")
    monkeypatch.setenv("ALPACA_API_KEY", "")
    with pytest.raises(MissingAlpacaKeys, match="ALPACA_KEY_ID"):
        alpaca_client()


def test_fetch_follows_pagination_and_sends_keys(keys):
    seen: list[httpx.Request] = []
    pages = [
        {"bars": {"AAPL": [bar("2026-10-13", 250), bar("2026-10-14", 251)]}, "next_page_token": "p2"},
        {"bars": {"AAPL": [bar("2026-10-15", 252)], "VOO": [bar("2026-10-15", 700)]}, "next_page_token": None},
    ]
    with alpaca_client(mock_alpaca(pages, seen)) as client:
        rows = list(fetch_bars(client, ("AAPL", "VOO"), date(2026, 10, 13)))

    assert len(rows) == 4
    assert rows[0][0] == datetime(2026, 10, 13, 4, tzinfo=timezone.utc)
    assert rows[0][1:6] == ("AAPL", 249, 251, 248, 250)
    assert seen[0].headers["APCA-API-KEY-ID"] == "test-key"
    assert seen[0].url.params["feed"] == "iex"
    assert seen[0].url.params["timeframe"] == "1Day"
    assert "page_token" not in seen[0].url.params
    assert seen[1].url.params["page_token"] == "p2"


def test_http_errors_surface(keys):
    transport = httpx.MockTransport(lambda r: httpx.Response(403, json={"message": "forbidden"}))
    with alpaca_client(transport) as client, pytest.raises(httpx.HTTPStatusError):
        list(fetch_bars(client, ("AAPL",), date(2026, 10, 13)))


# Refresh schedule -----------------------------------------------------------

def test_no_refresh_on_weekends():
    assert not should_refresh(SATURDAY, None)


def test_refresh_every_15_minutes_in_market_hours():
    assert should_refresh(WED_11AM_NY, None)
    assert not should_refresh(WED_11AM_NY, WED_11AM_NY - timedelta(minutes=10))
    assert should_refresh(WED_11AM_NY, WED_11AM_NY - timedelta(minutes=15))


# CSV fallback ---------------------------------------------------------------

def test_csv_has_every_symbol():
    csv = CsvPriceSource()
    for s in ingest_alpaca.SYMBOLS:
        assert csv.latest(s) is not None, s
        assert len(csv.closes(s, date(2000, 1, 1))) >= 400


def test_database_down_falls_back_to_csv(caplog):
    dead = ConnectionPool("host=127.0.0.1 port=1 dbname=x user=x connect_timeout=1",
                          min_size=0, max_size=1, timeout=2, open=True)
    try:
        prices = FallbackPriceSource(PriceStore(dead), CsvPriceSource())
        with caplog.at_level(logging.WARNING, logger="sonar.fallback"):
            latest = prices.latest("VOO")
            month = prices.closes("VOO", latest.day - timedelta(days=31))
        assert latest == CsvPriceSource().latest("VOO")
        assert 18 <= len(month) <= 24
        assert prices.fallback_count == 2
        assert "using CSV fallback" in caplog.text
    finally:
        dead.close()


# Database -------------------------------------------------------------------

needs_db = pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="DATABASE_URL not set")


@pytest.fixture
def pool():
    from config import load_settings
    from db import make_pool
    p = make_pool(load_settings())
    yield p
    p.close()


@pytest.mark.db
@needs_db
def test_upsert_is_idempotent(pool, keys):
    symbol = "TEST_INGEST"
    pages = [{"bars": {symbol: [bar("2020-01-06", 10), bar("2020-01-07", 11)]}}] * 2
    seen: list[httpx.Request] = []
    try:
        with alpaca_client(mock_alpaca(pages, seen)) as client:
            first = upsert(pool, list(fetch_bars(client, (symbol,), date(2020, 1, 6))))
            second = upsert(pool, list(fetch_bars(client, (symbol,), date(2020, 1, 6))))
        with pool.connection() as conn:
            rows = conn.execute("SELECT close, source FROM prices WHERE symbol = %s ORDER BY time",
                                (symbol,)).fetchall()
        assert first == second == 2
        assert rows == [(10, "alpaca-iex"), (11, "alpaca-iex")]
    finally:
        with pool.connection() as conn:
            conn.execute("DELETE FROM prices WHERE symbol = %s", (symbol,))


@pytest.mark.db
@pytest.mark.skipif(not alpaca_key_id(), reason="ALPACA_KEY_ID not set")
def test_live_alpaca_week_of_aapl():
    with alpaca_client() as client:
        rows = list(fetch_bars(client, ("AAPL",), date(2026, 10, 12), date(2026, 10, 17)))
    assert len(rows) == 5
    assert all(r[1] == "AAPL" for r in rows)
