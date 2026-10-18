"""Postgres connections. Mirrors services/data/db.ts.

Tiger Data signs server certificates with its own CA (ca.timescale.com), so
we pin that CA and keep full verification (chain and hostname).
"""

from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from psycopg_pool import ConnectionPool

from config import REPO_ROOT, Settings

TIMESCALE_CA = REPO_ROOT / "backend" / "services" / "data" / "certs" / "timescale-ca.pem"
_DROP_PARAMS = {"sslmode", "sslrootcert", "uselibpqcompat"}


def conninfo(url: str, password: str | None = None) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in _DROP_PARAMS]
    if (parts.hostname or "").endswith(".tsdb.cloud.timescale.com"):
        query += [("sslmode", "verify-full"), ("sslrootcert", str(TIMESCALE_CA))]
    if password and not parts.password:
        query.append(("password", password))
    return urlunsplit(parts._replace(query=urlencode(query)))


def make_pool(settings: Settings, max_size: int = 5, timeout: float = 30) -> ConnectionPool:
    pool = ConnectionPool(
        conninfo(settings.database_url, settings.database_password),
        min_size=1,
        max_size=max_size,
        open=False,
    )
    try:
        pool.open(wait=True, timeout=timeout)
    except Exception:
        pool.close()
        raise
    return pool


def resolve_account(pool: ConnectionPool, account_id: str | None) -> str:
    """The configured account, else the seeded 'Demo learner'."""
    with pool.connection() as conn:
        if account_id:
            row = conn.execute("SELECT id FROM accounts WHERE id = %s", (account_id,)).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM accounts ORDER BY (name = 'Demo learner') DESC, created_at LIMIT 1"
            ).fetchone()
    if not row:
        raise RuntimeError("No practice account found. Run `npm run db:migrate` to seed one.")
    return str(row[0])


__all__ = ["conninfo", "make_pool", "resolve_account", "Path"]
