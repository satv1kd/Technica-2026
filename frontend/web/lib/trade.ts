/** View logic for the two-step trade flow: confirm, settle, and results. */

/** POST /propose from the trading engine. */
export interface TradeProposal {
  id: string;
  side: "buy" | "sell";
  symbol: string;
  asset_class: string;
  quantity: number;
  price: number;
  total: number;
  price_as_of?: string;
  price_note?: string;
  risk_note: string;
  expires_at: string;
  readback: string;
}

export interface Settlement {
  kind: "onchain" | "simulated" | "T+1" | string;
  ref?: string | null;
  settle_ms?: number | null;
  note?: string;
  explorer?: string;
  example_explorer?: string;
}

/** POST /confirm from the trading engine. */
export interface TradeResult {
  trade: {
    id: string;
    time: string;
    side: "buy" | "sell";
    symbol: string;
    asset_class: string;
    quantity: number;
    price: number;
    total: number;
  };
  settlement: Settlement;
  cash_after: number;
}

export interface Portfolio {
  cash: number;
  holdings: { symbol: string; quantity: number; price: number; value: number }[];
  invested: number;
  total_value: number;
  tip: string | null;
}

export const OFFER_MS = 60_000;

/** The least a proposal must carry: an id and the read-back the tutor speaks. */
export type ProposalLike = Partial<TradeProposal> & { id: string; readback: string };

/** True when the proposal carries the numbers the confirm panel shows. */
export function hasDetails(p: ProposalLike): p is TradeProposal {
  return typeof p.price === "number" && typeof p.total === "number" && typeof p.quantity === "number" && !!p.symbol && !!p.side;
}

const unit = (assetClass: string, qty: number) =>
  `${assetClass === "tokenized" ? "token" : "share"}${qty === 1 ? "" : "s"}`;

export const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Buy 2 PVOO" */
export function orderTitle(p: { side: string; quantity: number; symbol: string }): string {
  return `${p.side === "buy" ? "Buy" : "Sell"} ${p.quantity} ${p.symbol}`;
}

export function priceLine(p: TradeProposal): string {
  return `Price: ${money(p.price)} per ${unit(p.asset_class, 1)}`;
}

/** When the offer runs out, by the client's clock: never more than 60 s from now. */
export function offerDeadline(p: TradeProposal, now: number): number {
  const server = Date.parse(p.expires_at);
  return Number.isFinite(server) ? Math.min(server, now + OFFER_MS) : now + OFFER_MS;
}

export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export interface CheckItem {
  label: string;
  /** When this line ticks, after the trade fills. */
  atMs: number;
  state: "done" | "warning" | "info";
}

/** The settling checklist for each kind of settlement. */
export function checklist(s: Settlement): CheckItem[] {
  const signed: CheckItem = { label: "Signed with your practice key", atMs: 0, state: "done" };
  if (s.kind === "onchain") {
    const secs = ((s.settle_ms ?? 0) / 1000).toFixed(1);
    return [
      signed,
      { label: "Sent to Solana devnet", atMs: 600, state: "done" },
      { label: `Confirmed in ${secs} seconds`, atMs: 1200, state: "done" },
    ];
  }
  if (s.kind === "simulated") {
    return [
      signed,
      { label: "Recorded in ledger", atMs: 600, state: "done" },
      { label: "Devnet unavailable, simulated settlement", atMs: 1200, state: "warning" },
    ];
  }
  return [
    signed,
    { label: "Recorded in ledger", atMs: 600, state: "done" },
    { label: "Settles the next business day (T+1)", atMs: 1200, state: "info" },
  ];
}

export const SETTLE_HOLD_MS = 1800;

/** The Explorer link to show: this trade's, or an earlier example when simulated. */
export function explorerLink(s: Settlement): { href: string; example: boolean } | null {
  if (s.explorer) return { href: s.explorer, example: false };
  if (s.example_explorer) return { href: s.example_explorer, example: true };
  return null;
}

export function isDevnetUrl(href: string): boolean {
  return /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet$/.test(href);
}

/** Settlement comparison: a regular ETF trade vs. this token trade. */
export function settlementBars(s: Settlement | null) {
  const pvoo = s?.kind === "onchain" && s.settle_ms ? `${(s.settle_ms / 1000).toFixed(1)} seconds` : "about 2 seconds";
  return [
    { label: "Regular ETF trade", value: "Next business day (T+1)", fraction: 1 },
    { label: "PVOO on Solana", value: pvoo, fraction: 0.04 },
  ];
}

export const SINGLE_TAP = {
  ops: [{ op: "tap" as const, at: { x: 0.5, y: 0.5 }, label: "trade settled" }],
  alt: "One tap in the center of the palm: the trade settled.",
  legend: [],
};
