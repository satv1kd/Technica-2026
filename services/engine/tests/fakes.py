"""In-memory stand-ins that follow the same rules as the real ledger and prices."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from ledger import InsufficientFunds, InsufficientShares, Position, TradeRecord
from markets import Fill, Settlement
from prices import Close


class FakePrices:
    def __init__(self, series: dict[str, list[tuple[str, float]]]):
        self.series = {s: [Close(date.fromisoformat(d), Decimal(str(c))) for d, c in rows]
                       for s, rows in series.items()}

    def latest(self, symbol):
        rows = self.series.get(symbol)
        return rows[-1] if rows else None

    def closes(self, symbol, start):
        return [c for c in self.series.get(symbol, []) if c.day >= start]


class FakeLedger:
    def __init__(self, cash="10000"):
        self._cash = Decimal(cash)
        self._positions: dict[str, Position] = {}
        self._trades: list[TradeRecord] = []
        self.settlements: dict[str, Settlement] = {}

    def cash(self):
        return self._cash

    def position(self, symbol):
        return self._positions.get(symbol)

    def positions(self):
        return list(self._positions.values())

    def apply(self, fill: Fill, trade_id, metadata):
        pos = self._positions.get(fill.symbol)
        if fill.side == "buy":
            if fill.total > self._cash:
                raise InsufficientFunds(fill.total, self._cash)
            self._cash -= fill.total
            q0, c0 = (pos.quantity, pos.avg_cost) if pos else (Decimal(0), Decimal(0))
            q = q0 + fill.quantity
            self._positions[fill.symbol] = Position(
                fill.symbol, fill.asset_class, q, (q0 * c0 + fill.quantity * fill.price) / q)
        else:
            owned = pos.quantity if pos else Decimal(0)
            if fill.quantity > owned:
                raise InsufficientShares(fill.symbol, fill.quantity, owned)
            metadata = {**metadata, "avg_cost": str(pos.avg_cost)}
            left = owned - fill.quantity
            if left:
                self._positions[fill.symbol] = Position(fill.symbol, fill.asset_class, left, pos.avg_cost)
            else:
                del self._positions[fill.symbol]
            self._cash += fill.total
        t = TradeRecord(trade_id, datetime.now(timezone.utc), fill.symbol, fill.asset_class,
                        fill.side, fill.quantity, fill.price, "pending", None, metadata)
        self._trades.insert(0, t)
        return t

    def record_settlement(self, trade, settlement):
        self.settlements[trade.id] = settlement

    def trades(self, limit=50):
        return self._trades[:limit]

    def token_totals(self, symbol):
        onchain = simulated = Decimal(0)
        for t in self._trades:
            if t.symbol != symbol:
                continue
            s = self.settlements.get(t.id)
            signed = t.quantity if t.side == "buy" else -t.quantity
            if s and s.kind == "onchain":
                onchain += signed
            elif s and s.kind == "simulated":
                simulated += signed
        return onchain, simulated


class FakeChain:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls: list[tuple[str, Decimal]] = []
        self.total = Decimal(0)

    def supply(self):
        if self.fail:
            from markets.pvoo import ChainUnavailable
            raise ChainUnavailable("devnet down")
        return self.total

    def mint(self, amount):
        return self._op("mint", amount)

    def burn(self, amount):
        return self._op("burn", amount)

    def _op(self, op, amount):
        if self.fail:
            raise TimeoutError("devnet down")
        self.calls.append((op, amount))
        self.total += amount if op == "mint" else -amount
        return f"sig-{op}-{len(self.calls)}"


class Clock:
    """A clock tests can move forward."""

    def __init__(self, start: datetime):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, seconds: float):
        self.now += timedelta(seconds=seconds)


def daily(start: str, closes: list[float]) -> list[tuple[str, float]]:
    d0 = date.fromisoformat(start)
    return [((d0 + timedelta(days=i)).isoformat(), c) for i, c in enumerate(closes)]
