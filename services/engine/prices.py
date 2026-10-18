"""Read-only access to stored prices, plus market-hours logic."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol
from zoneinfo import ZoneInfo

from psycopg_pool import ConnectionPool

NEW_YORK = ZoneInfo("America/New_York")

RANGES = {"1w": 7, "1m": 31, "3m": 92, "6m": 183, "1y": 366, "2y": 731}


class UnknownRange(ValueError):
    pass


def range_start(rng: str, latest: date) -> date:
    """'1m', '1y', ... relative to the latest stored day, or an ISO date."""
    if rng in RANGES:
        return latest - timedelta(days=RANGES[rng])
    try:
        return date.fromisoformat(rng)
    except ValueError:
        raise UnknownRange(f"Unknown range {rng!r}. Use one of {', '.join(RANGES)} or YYYY-MM-DD.")


@dataclass(frozen=True)
class Close:
    day: date
    close: Decimal


class PriceSource(Protocol):
    def latest(self, symbol: str) -> Close | None: ...
    def closes(self, symbol: str, start: date) -> list[Close]: ...


CENTS = Decimal("0.01")


def to_money(value: float) -> Decimal:
    """Stored closes can have sub-cent digits (701.745); trades fill in cents."""
    return Decimal(str(value)).quantize(CENTS, ROUND_HALF_UP)


class PriceStore:
    """Daily closes from the `prices` hypertable."""

    def __init__(self, pool: ConnectionPool):
        self.pool = pool

    def latest(self, symbol: str) -> Close | None:
        with self.pool.connection() as conn:
            row = conn.execute(
                """SELECT time, close FROM prices
                   WHERE symbol = %s AND close IS NOT NULL
                   ORDER BY time DESC LIMIT 1""",
                (symbol,),
            ).fetchone()
        return Close(_trading_day(row[0]), to_money(row[1])) if row else None

    def closes(self, symbol: str, start: date) -> list[Close]:
        with self.pool.connection() as conn:
            rows = conn.execute(
                """SELECT time, close FROM prices
                   WHERE symbol = %s AND close IS NOT NULL AND time >= %s
                   ORDER BY time""",
                (symbol, datetime.combine(start, time.min, NEW_YORK)),
            ).fetchall()
        return [Close(_trading_day(t), to_money(c)) for t, c in rows]


def _trading_day(ts: datetime) -> date:
    # Daily bars are stamped at midnight New York time.
    return ts.astimezone(NEW_YORK).date()


# Market hours ---------------------------------------------------------------

# NYSE full-day closures for the dates the demo can plausibly hit.
HOLIDAYS = {
    date(2026, 11, 26), date(2026, 12, 25),
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15),
}


def market_open(now: datetime) -> bool:
    ny = now.astimezone(NEW_YORK)
    if ny.weekday() >= 5 or ny.date() in HOLIDAYS:
        return False
    return time(9, 30) <= ny.time() < time(16, 0)


def price_note(now: datetime, as_of: date) -> str:
    """What the tutor says about where a price came from."""
    spoken = f"{as_of:%A}, {as_of:%B} {as_of.day}"
    if market_open(now):
        return f"This is the most recent closing price, from {spoken}."
    return f"The market is closed, so this is the last closing price, from {spoken}."
