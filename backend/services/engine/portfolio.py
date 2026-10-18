from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from coaching import coaching_tip
from ledger import LedgerStore
from markets import MarketRegistry

STARTING_CASH = Decimal(10_000)
CENTS = Decimal("0.01")


@dataclass(frozen=True)
class Holding:
    symbol: str
    asset_class: str
    quantity: Decimal
    avg_cost: Decimal
    price: Decimal
    as_of: str

    @property
    def value(self) -> Decimal:
        return (self.price * self.quantity).quantize(CENTS, ROUND_HALF_UP)

    @property
    def cost(self) -> Decimal:
        return (self.avg_cost * self.quantity).quantize(CENTS, ROUND_HALF_UP)

    @property
    def gain(self) -> Decimal:
        return self.value - self.cost


@dataclass(frozen=True)
class PortfolioSummary:
    cash: Decimal
    holdings: list[Holding]
    trade_count: int
    tip: str | None

    @property
    def invested(self) -> Decimal:
        return sum((h.value for h in self.holdings), Decimal(0))

    @property
    def total_value(self) -> Decimal:
        return self.cash + self.invested

    @property
    def total_gain(self) -> Decimal:
        return self.total_value - STARTING_CASH

    def weights(self) -> dict[str, Decimal]:
        total = self.total_value
        return {h.symbol: h.value / total for h in self.holdings} if total else {}


def summarize(ledger: LedgerStore, registry: MarketRegistry, now: datetime) -> PortfolioSummary:
    holdings = []
    for p in ledger.positions():
        q = registry.market(p.symbol).quote(p.symbol)
        holdings.append(
            Holding(p.symbol, p.asset_class, Decimal(p.quantity), Decimal(p.avg_cost), q.price, q.as_of.isoformat())
        )
    trades = ledger.trades(limit=500)
    partial = PortfolioSummary(ledger.cash(), holdings, len(trades), None)
    tip = coaching_tip(partial.weights(), trades, now)
    return PortfolioSummary(partial.cash, holdings, len(trades), tip)
