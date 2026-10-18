"""PVOO: a practice token on Solana devnet. One PVOO mirrors one VOO share.

Settlement mints (buy) or burns (sell) through the chain service. If devnet
is slow or down, the trade still fills on the ledger and is marked
"simulated", and the tutor says so out loud.
"""

import time
from decimal import Decimal
from typing import Protocol

import httpx

from prices import PriceSource

from .base import Fill, Market, NoPriceData, Quote, Settlement

CHAIN_TIMEOUT_S = 8.0


class ChainClient(Protocol):
    def mint(self, amount: Decimal) -> str: ...
    def burn(self, amount: Decimal) -> str: ...


class HttpChainClient:
    """Talks to services/chain (POST /mint, POST /burn)."""

    def __init__(self, base_url: str, timeout: float = CHAIN_TIMEOUT_S):
        self.base_url = base_url
        self.timeout = timeout

    def _call(self, op: str, amount: Decimal) -> str:
        r = httpx.post(f"{self.base_url}/{op}", json={"amount": str(amount)}, timeout=self.timeout)
        r.raise_for_status()
        return r.json()["signature"]

    def mint(self, amount: Decimal) -> str:
        return self._call("mint", amount)

    def burn(self, amount: Decimal) -> str:
        return self._call("burn", amount)


def explorer_link(signature: str) -> str:
    return f"https://explorer.solana.com/tx/{signature}?cluster=devnet"


class PvooMarket(Market):
    asset_class = "tokenized"
    symbols = ("PVOO",)
    fractional = True
    risk_note = (
        "PVOO is a practice token. Tokens depend on trust: the issuer must really hold "
        "the shares, and whoever holds the keys controls the tokens."
    )

    def __init__(self, prices: PriceSource, chain: ChainClient):
        self.prices = prices
        self.chain = chain

    def quote(self, symbol: str) -> Quote:
        latest = self.prices.latest("VOO")
        if latest is None:
            raise NoPriceData("No stored prices for VOO, which PVOO mirrors.")
        return Quote(symbol, latest.close, latest.day, self.asset_class)

    def settle(self, fill: Fill) -> Settlement:
        op = self.chain.mint if fill.side == "buy" else self.chain.burn
        started = time.perf_counter()
        try:
            signature = op(fill.quantity)
        except Exception as exc:  # network error, timeout, chain service down
            return Settlement(
                kind="simulated",
                note=(
                    "Solana devnet didn't answer in time, so this trade was recorded on "
                    "Sonar's ledger only, as a simulated settlement."
                ),
                extra={"error": type(exc).__name__},
            )
        ms = int((time.perf_counter() - started) * 1000)
        return Settlement(
            kind="onchain",
            ref=signature,
            settle_ms=ms,
            note=f"That settled on Solana devnet in {ms / 1000:.1f} seconds.",
            extra={"explorer": explorer_link(signature)},
        )

    def describe(self, symbol: str) -> dict:
        return {**super().describe(symbol), "kind": "token", "mirrors": "VOO"}
