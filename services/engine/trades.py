"""Two-step trades: propose, then confirm. Enforced here, not in the prompt.

`confirm` only works on a live proposal (60 seconds), and each proposal can
be confirmed at most once, even if two requests race.
"""

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from ledger import InsufficientFunds, InsufficientShares, LedgerStore, TradeRecord
from markets import Fill, MarketRegistry, Settlement
from prices import price_note

PROPOSAL_TTL = timedelta(seconds=60)
MAX_QUANTITY = Decimal(10_000)
TOKEN_DECIMALS = 6


class InvalidOrder(ValueError):
    pass


class NoProposal(LookupError):
    def __str__(self) -> str:
        return "There's no order waiting to be confirmed. Ask for a quote first."


class ProposalExpired(LookupError):
    def __str__(self) -> str:
        return "That offer expired. Want me to quote it again?"


@dataclass(frozen=True)
class Proposal:
    id: str
    fill: Fill
    created_at: datetime
    expires_at: datetime
    as_of: str
    price_note: str
    risk_note: str

    @property
    def readback(self) -> str:
        f = self.fill
        unit = "token" if f.asset_class == "tokenized" else "share"
        qty = f.quantity.normalize()
        units = unit if qty == 1 else unit + "s"
        verb = "Buy" if f.side == "buy" else "Sell"
        return (
            f"{verb} {qty:f} {units} of {f.symbol} at {f.price:,.2f} dollars each, "
            f"{f.total:,.2f} dollars total. {self.risk_note} "
            f"This is practice money. Press Enter or say confirm to place it, or Escape to cancel."
        )


@dataclass(frozen=True)
class TradeResult:
    trade: TradeRecord
    settlement: Settlement
    cash_after: Decimal


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TradeDesk:
    def __init__(
        self,
        registry: MarketRegistry,
        ledger: LedgerStore,
        clock: Callable[[], datetime] = utcnow,
        ttl: timedelta = PROPOSAL_TTL,
    ):
        self.registry = registry
        self.ledger = ledger
        self.clock = clock
        self.ttl = ttl
        self._proposals: dict[str, Proposal] = {}
        self._lock = threading.Lock()

    def propose(self, side: str, symbol: str, quantity) -> Proposal:
        side = str(side).lower()
        if side not in ("buy", "sell"):
            raise InvalidOrder("Side must be buy or sell.")
        symbol = str(symbol).upper()
        market = self.registry.market(symbol)
        qty = _parse_quantity(quantity, market.fractional, symbol)

        fill = market.fill(side, symbol, qty)
        # Early, friendly checks. The ledger re-checks atomically on confirm.
        if side == "buy":
            cash = self.ledger.cash()
            if fill.total > cash:
                raise InsufficientFunds(fill.total, cash)
        else:
            pos = self.ledger.position(symbol)
            owned = pos.quantity if pos else Decimal(0)
            if qty > owned:
                raise InsufficientShares(symbol, qty, owned)

        now = self.clock()
        quote = market.quote(symbol)
        proposal = Proposal(
            id=uuid.uuid4().hex[:12],
            fill=fill,
            created_at=now,
            expires_at=now + self.ttl,
            as_of=quote.as_of.isoformat(),
            price_note=price_note(now, quote.as_of),
            risk_note=market.risk_note_for(symbol),
        )
        with self._lock:
            self._prune(now)
            self._proposals[proposal.id] = proposal
        return proposal

    def confirm(self, proposal_id: str) -> TradeResult:
        now = self.clock()
        with self._lock:
            # Popping under the lock means a proposal executes at most once.
            proposal = self._proposals.pop(proposal_id, None)
        if proposal is None:
            raise NoProposal()
        if now >= proposal.expires_at:
            raise ProposalExpired()

        fill = proposal.fill
        trade = self.ledger.apply(fill, proposal.id, {"proposed_at": proposal.created_at.isoformat(),
                                                      "price_as_of": proposal.as_of})
        settlement = self.registry.market(fill.symbol).settle(fill)
        self.ledger.record_settlement(trade, settlement)
        return TradeResult(trade, settlement, self.ledger.cash())

    def cancel(self, proposal_id: str) -> Proposal:
        with self._lock:
            proposal = self._proposals.pop(proposal_id, None)
        if proposal is None:
            raise NoProposal()
        return proposal

    def _prune(self, now: datetime) -> None:
        # Keep expired proposals briefly so confirm can say "expired"
        # instead of "no proposal".
        cutoff = now - timedelta(minutes=10)
        for pid in [p.id for p in self._proposals.values() if p.expires_at < cutoff]:
            del self._proposals[pid]


def _parse_quantity(raw, fractional: bool, symbol: str) -> Decimal:
    try:
        qty = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise InvalidOrder("Quantity must be a number.") from None
    if not qty.is_finite() or qty <= 0:
        raise InvalidOrder("Quantity must be more than zero.")
    if qty > MAX_QUANTITY:
        raise InvalidOrder(f"Practice orders are limited to {MAX_QUANTITY:,} at a time.")
    if not fractional and qty != qty.to_integral_value():
        raise InvalidOrder(
            f"{symbol} trades in whole shares here. Fractional amounts are one of the things "
            f"a token like PVOO makes easy."
        )
    if fractional and -qty.as_tuple().exponent > TOKEN_DECIMALS:
        raise InvalidOrder(f"{symbol} supports up to {TOKEN_DECIMALS} decimal places.")
    return qty
