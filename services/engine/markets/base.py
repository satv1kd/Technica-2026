"""The plug-in market interface. Adding a market touches no other code:
subclass Market, then add it to `default_registry` in markets/__init__.py."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class Quote:
    symbol: str
    price: Decimal
    as_of: date
    asset_class: str


@dataclass(frozen=True)
class Fill:
    symbol: str
    asset_class: str
    side: str  # "buy" or "sell"
    quantity: Decimal
    price: Decimal

    @property
    def total(self) -> Decimal:
        return (self.price * self.quantity).quantize(Decimal("0.01"), ROUND_HALF_UP)


@dataclass(frozen=True)
class Settlement:
    kind: str  # "T+1", "onchain", or "simulated"
    ref: str | None = None  # transaction signature for on-chain settlement
    settle_ms: int | None = None
    note: str = ""
    extra: dict = field(default_factory=dict)


class Market(ABC):
    asset_class: str
    symbols: tuple[str, ...]
    #: Whether fractional quantities are allowed (tokens yes, stock shares no).
    fractional: bool = False
    #: One-line risk note read back before every trade.
    risk_note: str = "Prices can fall as well as rise, and you could get back less than you put in."

    @abstractmethod
    def quote(self, symbol: str) -> Quote: ...

    def fill(self, side: str, symbol: str, quantity: Decimal) -> Fill:
        q = self.quote(symbol)
        return Fill(symbol, self.asset_class, side, quantity, q.price)

    @abstractmethod
    def settle(self, fill: Fill) -> Settlement: ...

    def risk_note_for(self, symbol: str) -> str:
        return self.risk_note

    def describe(self, symbol: str) -> dict:
        return {"symbol": symbol, "asset_class": self.asset_class, "fractional": self.fractional}


class UnknownSymbol(KeyError):
    def __init__(self, symbol: str):
        super().__init__(symbol)
        self.symbol = symbol

    def __str__(self) -> str:
        return f"Sonar doesn't trade {self.symbol}."


class NoPriceData(LookupError):
    pass


class MarketRegistry:
    def __init__(self, markets: list[Market]):
        self._by_symbol: dict[str, Market] = {}
        for m in markets:
            for s in m.symbols:
                if s in self._by_symbol:
                    raise ValueError(f"{s} is registered by two markets")
                self._by_symbol[s] = m

    def market(self, symbol: str) -> Market:
        try:
            return self._by_symbol[symbol.upper()]
        except KeyError:
            raise UnknownSymbol(symbol.upper()) from None

    def symbols(self) -> list[str]:
        return list(self._by_symbol)

    def describe(self) -> list[dict]:
        return [m.describe(s) for s, m in self._by_symbol.items()]
