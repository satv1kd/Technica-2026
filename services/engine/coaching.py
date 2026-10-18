"""Rule-based habit tips. Educational framing only: Sonar teaches, it doesn't recommend."""

from datetime import datetime, timedelta
from decimal import Decimal

from ledger import TradeRecord

TIP_EVERY = 3
CONCENTRATION_LIMIT = Decimal("0.5")
FREQUENT_TRADES = 5


def coaching_tip(
    weights: dict[str, Decimal], trades: list[TradeRecord], now: datetime
) -> str | None:
    """One tip every TIP_EVERY trades. `trades` is newest first; `weights` are
    each holding's share of total account value (cash included)."""
    if not trades or len(trades) % TIP_EVERY != 0:
        return None

    heavy = [s for s, w in weights.items() if w > CONCENTRATION_LIMIT]
    if heavy:
        return (
            f"More than half of your account is in {heavy[0]}. When one holding is that big, "
            f"its ups and downs become your ups and downs. Spreading money out is called diversification."
        )

    recent = [t for t in trades if t.time >= now - timedelta(days=1)]
    if len(recent) >= FREQUENT_TRADES:
        return (
            f"You've made {len(recent)} trades in the last day. Frequent trading can add costs, "
            f"and studies show it often lowers returns for beginners."
        )

    last = trades[0]
    avg_cost = last.metadata.get("avg_cost") if last.metadata else None
    if last.side == "sell" and avg_cost and last.price < Decimal(avg_cost):
        return (
            f"You sold {last.symbol} for less than you paid. Selling right after a drop "
            f"locks in the loss. Many long-term investors decide ahead of time how they'll handle dips."
        )

    return (
        "A habit worth knowing: many long-term investors add small amounts regularly "
        "instead of trying to guess the best day to buy."
    )
