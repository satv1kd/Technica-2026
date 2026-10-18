from prices import PriceSource

from .base import Fill, Market, MarketRegistry, NoPriceData, Quote, Settlement, UnknownSymbol
from .equity import EquityMarket
from .pvoo import ChainClient, PvooMarket


def default_registry(prices: PriceSource, chain: ChainClient) -> MarketRegistry:
    return MarketRegistry([EquityMarket(prices), PvooMarket(prices, chain)])


__all__ = [
    "ChainClient", "EquityMarket", "Fill", "Market", "MarketRegistry", "NoPriceData",
    "PvooMarket", "Quote", "Settlement", "UnknownSymbol", "default_registry",
]
