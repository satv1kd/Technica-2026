"""Cash, positions, and trade history for one practice account.

Every fill is one database transaction: the cash change, the position change,
the trade row, and a learning event all commit together or not at all.
Cash can't go negative: the debit is conditional (`cash >= total`) and the
accounts_cash_nonnegative constraint backs it up.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from markets import Fill, Settlement


class InsufficientFunds(Exception):
    def __init__(self, needed: Decimal, available: Decimal):
        self.needed, self.available = needed, available
        super().__init__(
            f"That costs {needed:,.2f} dollars, but you have {available:,.2f} in practice cash."
        )


class InsufficientShares(Exception):
    def __init__(self, symbol: str, wanted: Decimal, owned: Decimal):
        self.symbol, self.wanted, self.owned = symbol, wanted, owned
        super().__init__(f"You own {owned.normalize():f} {symbol}, so you can't sell {wanted.normalize():f}.")


@dataclass(frozen=True)
class Position:
    symbol: str
    asset_class: str
    quantity: Decimal
    avg_cost: Decimal


@dataclass(frozen=True)
class TradeRecord:
    id: str
    time: datetime
    symbol: str
    asset_class: str
    side: str
    quantity: Decimal
    price: Decimal
    settlement: str | None
    settlement_ref: str | None
    metadata: dict

    @property
    def total(self) -> Decimal:
        return (self.price * self.quantity).quantize(Decimal("0.01"), ROUND_HALF_UP)


class LedgerStore(Protocol):
    def cash(self) -> Decimal: ...
    def position(self, symbol: str) -> Position | None: ...
    def positions(self) -> list[Position]: ...
    def apply(self, fill: Fill, trade_id: str, metadata: dict) -> TradeRecord: ...
    def record_settlement(self, trade: TradeRecord, settlement: Settlement) -> None: ...
    def trades(self, limit: int = 50) -> list[TradeRecord]: ...
    def token_totals(self, symbol: str) -> tuple[Decimal, Decimal]: ...


class Ledger:
    def __init__(self, pool: ConnectionPool, account_id: str):
        self.pool = pool
        self.account_id = account_id

    def cash(self) -> Decimal:
        with self.pool.connection() as conn:
            row = conn.execute("SELECT cash FROM accounts WHERE id = %s", (self.account_id,)).fetchone()
        return Decimal(row[0])

    def position(self, symbol: str) -> Position | None:
        with self.pool.connection() as conn:
            row = conn.execute(
                """SELECT symbol, asset_class, quantity, avg_cost FROM positions
                   WHERE account_id = %s AND symbol = %s AND quantity > 0""",
                (self.account_id, symbol),
            ).fetchone()
        return Position(*row) if row else None

    def positions(self) -> list[Position]:
        with self.pool.connection() as conn:
            rows = conn.execute(
                """SELECT symbol, asset_class, quantity, avg_cost FROM positions
                   WHERE account_id = %s AND quantity > 0 ORDER BY symbol""",
                (self.account_id,),
            ).fetchall()
        return [Position(*r) for r in rows]

    def apply(self, fill: Fill, trade_id: str, metadata: dict) -> TradeRecord:
        total = fill.total
        acct = self.account_id
        with self.pool.connection() as conn, conn.transaction():
            if fill.side == "buy":
                debited = conn.execute(
                    """UPDATE accounts SET cash = cash - %s
                       WHERE id = %s AND cash >= %s RETURNING cash""",
                    (total, acct, total),
                ).fetchone()
                if debited is None:
                    raise InsufficientFunds(total, self._cash(conn))
                conn.execute(
                    """INSERT INTO positions (account_id, symbol, asset_class, quantity, avg_cost)
                       VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (account_id, symbol) DO UPDATE SET
                         avg_cost = (positions.quantity * positions.avg_cost
                                     + EXCLUDED.quantity * EXCLUDED.avg_cost)
                                    / (positions.quantity + EXCLUDED.quantity),
                         quantity = positions.quantity + EXCLUDED.quantity""",
                    (acct, fill.symbol, fill.asset_class, fill.quantity, fill.price),
                )
            else:
                sold = conn.execute(
                    """UPDATE positions SET quantity = quantity - %s
                       WHERE account_id = %s AND symbol = %s AND quantity >= %s
                       RETURNING avg_cost""",
                    (fill.quantity, acct, fill.symbol, fill.quantity),
                ).fetchone()
                if sold is None:
                    owned = conn.execute(
                        "SELECT quantity FROM positions WHERE account_id = %s AND symbol = %s",
                        (acct, fill.symbol),
                    ).fetchone()
                    raise InsufficientShares(fill.symbol, fill.quantity, Decimal(owned[0]) if owned else Decimal(0))
                metadata = {
                    **metadata,
                    "realized_gain": str(((fill.price - Decimal(sold[0])) * fill.quantity).quantize(Decimal("0.01"), ROUND_HALF_UP)),
                    "avg_cost": str(sold[0]),
                }
                conn.execute(
                    "DELETE FROM positions WHERE account_id = %s AND symbol = %s AND quantity = 0",
                    (acct, fill.symbol),
                )
                conn.execute("UPDATE accounts SET cash = cash + %s WHERE id = %s", (total, acct))

            row = conn.execute(
                """INSERT INTO trades (id, account_id, symbol, asset_class, side, quantity, price,
                                       settlement, metadata)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending', %s)
                   RETURNING time""",
                (trade_id, acct, fill.symbol, fill.asset_class, fill.side, fill.quantity,
                 fill.price, Jsonb(metadata)),
            ).fetchone()
            conn.execute(
                "INSERT INTO learning_events (account_id, kind, detail) VALUES (%s, 'trade', %s)",
                (acct, Jsonb({"trade_id": trade_id, "side": fill.side, "symbol": fill.symbol,
                              "quantity": str(fill.quantity), "price": str(fill.price)})),
            )
        return TradeRecord(trade_id, row[0], fill.symbol, fill.asset_class, fill.side,
                           fill.quantity, fill.price, "pending", None, metadata)

    def record_settlement(self, trade: TradeRecord, settlement: Settlement) -> None:
        extra = {"settlement_note": settlement.note, **settlement.extra}
        if settlement.settle_ms is not None:
            extra["settle_ms"] = settlement.settle_ms
        with self.pool.connection() as conn:
            conn.execute(
                """UPDATE trades SET settlement = %s, settlement_ref = %s, metadata = metadata || %s
                   WHERE id = %s AND time = %s""",
                (settlement.kind, settlement.ref, Jsonb(extra), trade.id, trade.time),
            )

    def trades(self, limit: int = 50) -> list[TradeRecord]:
        with self.pool.connection() as conn:
            rows = conn.execute(
                """SELECT id, time, symbol, asset_class, side, quantity, price,
                          settlement, settlement_ref, metadata
                   FROM trades WHERE account_id = %s ORDER BY time DESC LIMIT %s""",
                (self.account_id, limit),
            ).fetchall()
        return [TradeRecord(*r) for r in rows]

    def token_totals(self, symbol: str) -> tuple[Decimal, Decimal]:
        """Net tokens across ALL accounts: (settled on chain, simulated only).
        On-chain supply should equal the first number exactly."""
        with self.pool.connection() as conn:
            row = conn.execute(
                """SELECT
                     COALESCE(SUM(CASE WHEN settlement = 'onchain'
                       THEN CASE side WHEN 'buy' THEN quantity ELSE -quantity END END), 0),
                     COALESCE(SUM(CASE WHEN settlement = 'simulated'
                       THEN CASE side WHEN 'buy' THEN quantity ELSE -quantity END END), 0)
                   FROM trades WHERE symbol = %s""",
                (symbol,),
            ).fetchone()
        return Decimal(row[0]), Decimal(row[1])

    def _cash(self, conn) -> Decimal:
        return Decimal(
            conn.execute("SELECT cash FROM accounts WHERE id = %s", (self.account_id,)).fetchone()[0]
        )
