"""Write data/fallback/<SYMBOL>.csv from the prices table.

    .venv/Scripts/python export_fallback.py
"""

import csv

from config import load_settings
from db import make_pool
from fallback import COLUMNS, FALLBACK_DIR
from ingest_alpaca import SYMBOLS


def export() -> dict[str, int]:
    FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
    pool = make_pool(load_settings())
    counts = {}
    try:
        with pool.connection() as conn:
            for symbol in SYMBOLS:
                rows = conn.execute(
                    "SELECT time, symbol, open, high, low, close, volume FROM prices "
                    "WHERE symbol = %s ORDER BY time",
                    (symbol,),
                ).fetchall()
                with (FALLBACK_DIR / f"{symbol}.csv").open("w", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(COLUMNS)
                    for t, *rest in rows:
                        w.writerow([t.isoformat(), *rest])
                counts[symbol] = len(rows)
    finally:
        pool.close()
    return counts


if __name__ == "__main__":
    for symbol, n in export().items():
        print(f"{symbol}: {n} rows")
