"""CSV backup for prices, used automatically when the database is unreachable.

Files live in data/fallback/<SYMBOL>.csv at the repo root, with the same
columns as the prices table. Refresh them with `python export_fallback.py`.
"""

import csv
import logging
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

import psycopg
from psycopg_pool import PoolTimeout

from config import REPO_ROOT
from prices import Close, PriceSource, _trading_day, to_money

FALLBACK_DIR = REPO_ROOT / "data" / "fallback"
COLUMNS = ["time", "symbol", "open", "high", "low", "close", "volume"]

log = logging.getLogger("sonar.fallback")


class CsvPriceSource:
    def __init__(self, directory: Path = FALLBACK_DIR):
        self.directory = directory

    @lru_cache(maxsize=32)
    def _load(self, symbol: str) -> tuple[Close, ...]:
        path = self.directory / f"{symbol}.csv"
        if not path.exists():
            return ()
        with path.open(newline="") as f:
            rows = [
                Close(_trading_day(datetime.fromisoformat(r["time"])), to_money(float(r["close"])))
                for r in csv.DictReader(f)
                if r["close"]
            ]
        return tuple(sorted(rows, key=lambda c: c.day))

    def latest(self, symbol: str) -> Close | None:
        rows = self._load(symbol)
        return rows[-1] if rows else None

    def closes(self, symbol: str, start: date) -> list[Close]:
        return [c for c in self._load(symbol) if c.day >= start]


# Errors that mean "the database is unreachable", not "the query is wrong".
DB_DOWN = (psycopg.OperationalError, PoolTimeout)


class FallbackPriceSource:
    """Database first; CSV when the database can't be reached."""

    def __init__(self, primary: PriceSource, backup: PriceSource):
        self.primary = primary
        self.backup = backup
        self.fallback_count = 0

    def _try(self, method: str, *args):
        try:
            return getattr(self.primary, method)(*args)
        except DB_DOWN as exc:
            self.fallback_count += 1
            log.warning("Database unreachable (%s); using CSV fallback for %s%s",
                        type(exc).__name__, method, args)
            return getattr(self.backup, method)(*args)

    def latest(self, symbol: str) -> Close | None:
        return self._try("latest", symbol)

    def closes(self, symbol: str, start: date) -> list[Close]:
        return self._try("closes", symbol, start)


class DatabaseUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("The practice account is offline because the database can't be reached. "
                         "Prices still work from the backup files.")


class OfflineLedger:
    """Stands in for the ledger when the engine starts without a database.
    Quotes, charts, and backtests still work; anything touching the account
    raises DatabaseUnavailable, which the API turns into a 503."""

    def _down(self, *_args, **_kwargs):
        raise DatabaseUnavailable()

    cash = position = positions = apply = record_settlement = trades = _down

    def token_totals(self, symbol: str) -> tuple[Decimal, Decimal]:
        self._down()
