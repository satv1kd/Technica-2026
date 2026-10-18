"""Practice options on the six equities (stretch goal, lesson 6).

Contracts are named UNDERLYING-C|P-STRIKE-YYYYMMDD, e.g. AAPL-C-350-20261120,
and cover 100 shares. Premiums come from Black-Scholes using the stock's own
realized volatility over the past year, so they move with real prices. You
can buy contracts and sell the ones you own; writing (selling options you
don't own) isn't allowed, so the most you can lose is what you paid.
"""

import math
import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache

from prices import PriceSource

from .base import Fill, Market, NoPriceData, Quote, Settlement
from .equity import EquityMarket

MULTIPLIER = 100
RISK_FREE_RATE = 0.04
DEFAULT_VOL = 0.25
MAX_DAYS_OUT = 730
CENT = Decimal("0.01")

SYMBOL_RE = re.compile(r"^([A-Z]+)-([CP])-(\d+(?:\.\d{1,2})?)-(\d{8})$")


class InvalidContract(ValueError):
    pass


@dataclass(frozen=True)
class Contract:
    underlying: str
    kind: str  # "call" or "put"
    strike: Decimal
    expiry: date

    @property
    def symbol(self) -> str:
        return f"{self.underlying}-{self.kind[0].upper()}-{self.strike.normalize():f}-{self.expiry:%Y%m%d}"

    def spoken(self) -> str:
        return (f"{self.underlying} {self.kind}, strike {self.strike.normalize():f} dollars, "
                f"expiring {self.expiry:%B} {self.expiry.day}")


def contract_symbol(underlying: str, kind: str, strike, expiry: str | date) -> str:
    """Build a symbol from parts, e.g. ("AAPL", "call", 350, "2026-11-20")."""
    k = str(kind).lower()
    if k not in ("call", "put", "c", "p"):
        raise InvalidContract("Option type must be call or put.")
    try:
        exp = expiry if isinstance(expiry, date) else date.fromisoformat(str(expiry))
        strike_d = Decimal(str(strike))
    except (ValueError, ArithmeticError):
        raise InvalidContract("Give the strike as a number and the expiry as YYYY-MM-DD.") from None
    return Contract(str(underlying).upper(), "call" if k[0] == "c" else "put", strike_d, exp).symbol


def parse_contract(symbol: str) -> Contract:
    m = SYMBOL_RE.match(symbol.upper())
    if not m:
        raise InvalidContract(f"{symbol} isn't an option contract. Use a name like AAPL-C-350-20261120.")
    und, cp, strike, exp = m.groups()
    if und not in EquityMarket.symbols:
        raise InvalidContract(f"Practice options are only on {', '.join(EquityMarket.symbols)}.")
    try:
        expiry = date(int(exp[:4]), int(exp[4:6]), int(exp[6:]))
    except ValueError:
        raise InvalidContract(f"{exp} isn't a real date.") from None
    strike_d = Decimal(strike)
    if strike_d <= 0:
        raise InvalidContract("The strike price must be more than zero.")
    return Contract(und, "call" if cp == "C" else "put", strike_d, expiry)


def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def black_scholes(kind: str, spot: float, strike: float, years: float, vol: float, rate: float = RISK_FREE_RATE) -> float:
    """Premium per share. At or after expiry it's the intrinsic value."""
    if years <= 0 or vol <= 0:
        return max(0.0, spot - strike) if kind == "call" else max(0.0, strike - spot)
    d1 = (math.log(spot / strike) + (rate + vol * vol / 2) * years) / (vol * math.sqrt(years))
    d2 = d1 - vol * math.sqrt(years)
    if kind == "call":
        return spot * _norm_cdf(d1) - strike * math.exp(-rate * years) * _norm_cdf(d2)
    return strike * math.exp(-rate * years) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def realized_vol(closes: list[float]) -> float:
    """Annualized volatility of daily log returns; DEFAULT_VOL if too little data."""
    rets = [math.log(b / a) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]
    if len(rets) < 20:
        return DEFAULT_VOL
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var * 252)


@dataclass(frozen=True)
class OptionQuote:
    contract: Contract
    as_of: date
    spot: Decimal
    vol: float
    premium: Decimal  # per share
    days_left: int

    @property
    def contract_cost(self) -> Decimal:
        return self.premium * MULTIPLIER

    @property
    def breakeven(self) -> Decimal:
        k = self.contract.strike
        return k + self.premium if self.contract.kind == "call" else k - self.premium

    def profit_at_expiry(self, price: Decimal) -> Decimal:
        k = self.contract.strike
        intrinsic = max(Decimal(0), price - k) if self.contract.kind == "call" else max(Decimal(0), k - price)
        return ((intrinsic - self.premium) * MULTIPLIER).quantize(CENT, ROUND_HALF_UP)

    @property
    def max_gain(self) -> Decimal | None:
        """None means unlimited (a call)."""
        if self.contract.kind == "call":
            return None
        return self.profit_at_expiry(Decimal(0))


class OptionsMarket(Market):
    asset_class = "option"
    symbols = ()  # contracts are created on demand; see handles()
    fractional = False
    risk_note = ("Most beginners lose money on options. If the stock doesn't pass the break-even "
                 "price by expiry, you lose everything you paid.")

    def __init__(self, prices: PriceSource):
        self.prices = prices

    def handles(self, symbol: str) -> bool:
        return bool(SYMBOL_RE.match(symbol.upper()))

    def option_quote(self, symbol: str) -> OptionQuote:
        c = parse_contract(symbol)
        latest = self.prices.latest(c.underlying)
        if latest is None:
            raise NoPriceData(f"No stored prices for {c.underlying}.")
        vol = self._vol(c.underlying, latest.day)
        days = (c.expiry - latest.day).days
        premium = black_scholes(c.kind, float(latest.close), float(c.strike), max(days, 0) / 365, vol)
        # A contract is never quoted below a cent a share.
        prem = max(CENT, Decimal(str(premium)).quantize(CENT, ROUND_HALF_UP)) if days > 0 else \
            Decimal(str(premium)).quantize(CENT, ROUND_HALF_UP)
        return OptionQuote(c, latest.day, latest.close, vol, prem, days)

    @lru_cache(maxsize=64)
    def _vol(self, underlying: str, as_of: date) -> float:
        closes = self.prices.closes(underlying, as_of - timedelta(days=365))
        return realized_vol([float(c.close) for c in closes])

    def quote(self, symbol: str) -> Quote:
        q = self.option_quote(symbol)
        return Quote(q.contract.symbol, q.contract_cost, q.as_of, self.asset_class)

    def fill(self, side: str, symbol: str, quantity: Decimal) -> Fill:
        q = self.option_quote(symbol)
        if side == "buy":
            if q.days_left <= 0:
                raise InvalidContract("That contract has expired. Pick a later expiry date.")
            if q.days_left > MAX_DAYS_OUT:
                raise InvalidContract("Practice contracts expire within two years.")
        return Fill(q.contract.symbol, self.asset_class, side, quantity, q.contract_cost)

    def order_text(self, fill: Fill) -> str:
        c = parse_contract(fill.symbol)
        n = fill.quantity.normalize()
        per_share = (fill.price / MULTIPLIER).quantize(CENT)
        return (f"{n:f} {c.underlying} {c.kind} {'contract' if n == 1 else 'contracts'}, strike "
                f"{c.strike.normalize():f} dollars, expiring {c.expiry:%B} {c.expiry.day}, "
                f"at {per_share:,.2f} dollars per share")

    def settle(self, fill: Fill) -> Settlement:
        return Settlement(kind="T+1", note="Options trades settle the next business day.")

    def describe_all(self) -> list[dict]:
        return [{"symbol": "options", "asset_class": self.asset_class, "fractional": False,
                 "underlyings": list(EquityMarket.symbols),
                 "format": "UNDERLYING-C|P-STRIKE-YYYYMMDD", "contract_size": MULTIPLIER}]
