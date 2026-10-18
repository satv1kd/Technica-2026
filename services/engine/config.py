"""Engine settings, read from the repo-root .env shared by every service."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    database_password: str | None
    chain_url: str
    account_id: str | None


def load_settings() -> Settings:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url.startswith(("postgres://", "postgresql://")):
        raise RuntimeError(
            "DATABASE_URL is missing or not a postgres:// URL. Set it in .env at the repo root."
        )
    return Settings(
        database_url=url,
        database_password=(os.getenv("DATABASE_PASSWORD") or "").strip() or None,
        chain_url=(os.getenv("CHAIN_URL") or "http://localhost:8001").rstrip("/"),
        account_id=(os.getenv("ENGINE_ACCOUNT_ID") or "").strip() or None,
    )
