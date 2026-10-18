import { describe, expect, it } from "vitest";
import {
  OFFER_MS, checklist, explorerLink, isDevnetUrl, money, offerDeadline, orderTitle, priceLine, secondsLeft, settlementBars,
  type TradeProposal,
} from "@web/lib/trade";

const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
  id: "p1", side: "buy", symbol: "PVOO", asset_class: "tokenized", quantity: 2, price: 701.75, total: 1403.5,
  risk_note: "Tokens depend on trust.", expires_at: new Date(1_000_000 + 60_000).toISOString(), readback: "", ...over,
});

describe("confirm panel text", () => {
  it("titles and prices the order", () => {
    expect(orderTitle(proposal())).toBe("Buy 2 PVOO");
    expect(orderTitle(proposal({ side: "sell", quantity: 1, symbol: "VOO" }))).toBe("Sell 1 VOO");
    expect(priceLine(proposal())).toBe("Price: $701.75 per token");
    expect(priceLine(proposal({ asset_class: "equity" }))).toBe("Price: $701.75 per share");
    expect(money(1403.5)).toBe("$1,403.50");
  });
});

describe("the 60-second offer", () => {
  it("uses the server's expiry but never more than 60 s from now", () => {
    expect(offerDeadline(proposal(), 1_000_000)).toBe(1_060_000);
    expect(offerDeadline(proposal({ expires_at: new Date(9e12).toISOString() }), 1_000_000)).toBe(1_000_000 + OFFER_MS);
    expect(offerDeadline(proposal({ expires_at: "not a date" }), 5)).toBe(5 + OFFER_MS);
  });

  it("counts whole seconds down to zero", () => {
    expect(secondsLeft(60_000, 0)).toBe(60);
    expect(secondsLeft(60_000, 59_001)).toBe(1);
    expect(secondsLeft(60_000, 61_000)).toBe(0);
  });
});

describe("settling checklist", () => {
  it("on chain: signed, sent, confirmed with the time", () => {
    expect(checklist({ kind: "onchain", settle_ms: 2140 }).map((c) => c.label)).toEqual([
      "Signed with your practice key", "Sent to Solana devnet", "Confirmed in 2.1 seconds",
    ]);
  });

  it("simulated: ledger only, with a warning", () => {
    const items = checklist({ kind: "simulated" });
    expect(items.map((c) => c.label)).toEqual([
      "Signed with your practice key", "Recorded in ledger", "Devnet unavailable, simulated settlement",
    ]);
    expect(items[2].state).toBe("warning");
  });

  it("regular shares settle T+1", () => {
    expect(checklist({ kind: "T+1" })[2].label).toBe("Settles the next business day (T+1)");
  });

  it("lines tick in order", () => {
    const at = checklist({ kind: "onchain", settle_ms: 900 }).map((c) => c.atMs);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});

describe("Explorer links", () => {
  const sig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

  it("prefers this trade's link, else an earlier example", () => {
    expect(explorerLink({ kind: "onchain", explorer: "a" })).toEqual({ href: "a", example: false });
    expect(explorerLink({ kind: "simulated", example_explorer: "b" })).toEqual({ href: "b", example: true });
    expect(explorerLink({ kind: "T+1" })).toBeNull();
  });

  it("accepts only devnet Explorer transaction URLs", () => {
    expect(isDevnetUrl(`https://explorer.solana.com/tx/${sig}?cluster=devnet`)).toBe(true);
    expect(isDevnetUrl(`https://explorer.solana.com/tx/${sig}`)).toBe(false);
    expect(isDevnetUrl("https://evil.example/tx/abc?cluster=devnet")).toBe(false);
  });
});

describe("settlement comparison", () => {
  it("shows T+1 against the real on-chain time", () => {
    const [etf, pvoo] = settlementBars({ kind: "onchain", settle_ms: 2140 });
    expect(etf.value).toBe("Next business day (T+1)");
    expect(pvoo.value).toBe("2.1 seconds");
    expect(pvoo.fraction).toBeLessThan(etf.fraction);
  });
});

describe("partial proposals", () => {
  it("only full proposals get the detailed confirm panel", async () => {
    const { hasDetails } = await import("@web/lib/trade");
    expect(hasDetails(proposal())).toBe(true);
    expect(hasDetails({ id: "p1", readback: "Buy 1 share of VOO." } as any)).toBe(false);
  });
});
