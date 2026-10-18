from prices import PriceSource

from .base import Fill, Market, NoPriceData, Quote, Settlement

ETFS = ("VOO", "SPY", "QQQ")
STOCKS = ("AAPL", "MSFT", "NVDA")


class EquityMarket(Market):
    asset_class = "equity"
    symbols = ETFS + STOCKS
    fractional = False

    def __init__(self, prices: PriceSource):
        self.prices = prices

    def risk_note_for(self, symbol: str) -> str:
        if symbol in ETFS:
            return (
                "A fund spreads your money across many companies, but it can still fall, "
                "sometimes by a lot."
            )
        return (
            "A single company's stock can swing a lot in one day, "
            "and you could get back less than you put in."
        )

    def quote(self, symbol: str) -> Quote:
        latest = self.prices.latest(symbol)
        if latest is None:
            raise NoPriceData(f"No stored prices for {symbol}.")
        return Quote(symbol, latest.close, latest.day, self.asset_class)

    def settle(self, fill: Fill) -> Settlement:
        return Settlement(
            kind="T+1",
            note="A regular trade like this settles the next business day.",
        )

    def describe(self, symbol: str) -> dict:
        return {**super().describe(symbol), "kind": "etf" if symbol in ETFS else "stock"}
