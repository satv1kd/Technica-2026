import { opsFromEngineChart, opsFromPayoff } from "../../chart/ops";
import { qs } from "../engine";
import type { Tool, ToolContext } from "./types";

const SYMBOL = { type: "string", description: "Ticker: VOO, SPY, QQQ, AAPL, MSFT, NVDA, or PVOO" };
const RANGE = { type: "string", enum: ["1w", "1m", "3m", "6m", "1y", "2y"], description: "Time range" };

/** Did the learner just say yes to the pending order? */
export const CONFIRM_RE = /\b(confirm(ed)?|yes|yeah|yep|do it|go ahead|place (it|the order|the trade)|buy it|sell it)\b/i;

export const listMarkets: Tool = {
  name: "list_markets",
  description: "List the assets Sonar can trade with practice money.",
  parameters: { type: "object", properties: {} },
  execute: (_, ctx) => ctx.engine("/markets"),
};

export const getQuote: Tool = {
  name: "get_quote",
  description: "Latest price for one asset, with a note saying whether the market is closed.",
  parameters: { type: "object", properties: { symbol: SYMBOL }, required: ["symbol"] },
  execute: ({ symbol }, ctx) => ctx.engine(`/quote${qs({ symbol })}`),
};

export const getPriceHistory: Tool = {
  name: "get_price_history",
  description: "Daily closing prices for one asset over a range.",
  parameters: { type: "object", properties: { symbol: SYMBOL, range: RANGE }, required: ["symbol"] },
  execute: ({ symbol, range = "1m" }, ctx) => ctx.engine(`/history${qs({ symbol, range })}`),
  forModel: (r) => {
    const pts = r.points ?? [];
    const first = pts[0], last = pts.at(-1);
    return first && last
      ? {
          symbol: r.symbol, range: r.range, days: pts.length,
          first: first, last: last,
          pct_change: Number((((last.close - first.close) / first.close) * 100).toFixed(1)),
          high: Math.max(...pts.map((p: any) => p.close)),
          low: Math.min(...pts.map((p: any) => p.close)),
        }
      : r;
  },
};

export const showChart: Tool = {
  name: "show_chart",
  description:
    "Draw a price chart on the learner's palm and screen. One symbol, or two to compare on one shared scale. " +
    "Returns the overall direction and percent change to narrate.",
  parameters: {
    type: "object",
    properties: {
      symbols: { type: "array", items: SYMBOL, description: "One or two tickers" },
      range: RANGE,
      markers: { type: "array", items: { type: "string", enum: ["peak", "trough", "end"] } },
    },
    required: ["symbols"],
  },
  async execute({ symbols, range = "1m", points = 12, markers = ["peak"] }, ctx) {
    const list = (Array.isArray(symbols) ? symbols : [symbols]).slice(0, 2).join(",");
    const chart = await ctx.engine(`/chart${qs({ symbols: list, range, points })}`);
    const ops = opsFromEngineChart(chart, markers);
    ctx.directives.push({ type: "chart", chart: ops });
    return { chart, ops };
  },
  forModel: (r) => ({
    drawn: true,
    range: r.chart.range,
    smoothing: r.chart.series.map((s: any) => s.smoothing),
    series: r.chart.series.map((s: any) => ({ symbol: s.symbol, ...s.summary })),
  }),
};

export const proposeTrade: Tool = {
  name: "propose_trade",
  description:
    "Step 1 of a practice trade: get the price, total, and risk note, and read it back. Nothing is bought yet. " +
    "Stocks and ETFs need whole shares; PVOO allows fractions.",
  parameters: {
    type: "object",
    properties: {
      side: { type: "string", enum: ["buy", "sell"] },
      symbol: SYMBOL,
      quantity: { type: "number", description: "Number of shares or tokens" },
    },
    required: ["side", "symbol", "quantity"],
  },
  async execute({ side, symbol, quantity, qty }, ctx) {
    const proposal = await ctx.engine("/propose", {
      method: "POST",
      body: { side, symbol, qty: String(quantity ?? qty) },
    });
    ctx.state.pendingProposal = { id: proposal.id };
    ctx.directives.push({ type: "confirm", proposal });
    return proposal;
  },
};

const CONTRACT = {
  underlying: { type: "string", enum: ["VOO", "SPY", "QQQ", "AAPL", "MSFT", "NVDA"] },
  type: { type: "string", enum: ["call", "put"] },
  strike: { type: "number", description: "Strike price in dollars" },
  expiry: { type: "string", description: "Expiration date, YYYY-MM-DD" },
};

export const getOptionQuote: Tool = {
  name: "get_option_quote",
  description:
    "Price a practice option contract (100 shares) and draw its profit at expiry on the palm. Returns the cost, " +
    "break-even, most you can lose, and most you can gain. For teaching; options are a stretch topic.",
  parameters: { type: "object", properties: CONTRACT, required: ["underlying", "type", "strike", "expiry"] },
  async execute({ underlying, type, strike, expiry }, ctx) {
    const quote = await ctx.engine(`/options/quote${qs({ underlying, type, strike, expiry })}`);
    ctx.directives.push({ type: "chart", chart: opsFromPayoff(quote) });
    return quote;
  },
  // The payoff points are for the drawing; the model narrates the summary.
  forModel: ({ payoff_at_expiry, ...rest }) => rest,
};

export const proposeOptionTrade: Tool = {
  name: "propose_option_trade",
  description:
    "Step 1 of a practice options trade: read back the contract, cost, and risk. Nothing is bought yet. " +
    "Learners can buy contracts or sell ones they own, never write new ones. Confirm with confirm_trade.",
  parameters: {
    type: "object",
    properties: {
      side: { type: "string", enum: ["buy", "sell"] },
      ...CONTRACT,
      contracts: { type: "number", description: "Number of contracts (whole numbers)" },
    },
    required: ["side", "underlying", "type", "strike", "expiry", "contracts"],
  },
  async execute({ side, underlying, type, strike, expiry, contracts }, ctx) {
    const symbol = `${String(underlying).toUpperCase()}-${String(type)[0].toUpperCase()}-${strike}-${String(expiry).replace(/-/g, "")}`;
    const proposal = await ctx.engine("/propose", { method: "POST", body: { side, symbol, qty: String(contracts) } });
    ctx.state.pendingProposal = { id: proposal.id };
    ctx.directives.push({ type: "confirm", proposal });
    return proposal;
  },
};

export class ConfirmRefused extends Error {}

export const confirmTrade: Tool = {
  name: "confirm_trade",
  description:
    "Step 2: place the pending practice trade. Only call this right after the learner clearly says confirm or yes " +
    "to the order you read back.",
  parameters: {
    type: "object",
    properties: { proposal_id: { type: "string" } },
    required: ["proposal_id"],
  },
  async execute({ proposal_id }, ctx: ToolContext) {
    const pending = ctx.state.pendingProposal?.id;
    if (!pending || (proposal_id && proposal_id !== pending)) {
      throw new ConfirmRefused("There is no order waiting for confirmation. Propose the trade first.");
    }
    if (!ctx.userConfirmed && !CONFIRM_RE.test(ctx.transcript)) {
      throw new ConfirmRefused("The learner has not confirmed. Ask them to say confirm or press Enter.");
    }
    const result = await ctx.engine("/confirm", { method: "POST", body: { id: pending } });
    ctx.state.pendingProposal = null;
    ctx.directives.push({ type: "settled", trade: result });
    return result;
  },
};

export const cancelTrade: Tool = {
  name: "cancel_trade",
  description: "Cancel the pending practice order.",
  parameters: { type: "object", properties: { proposal_id: { type: "string" } } },
  async execute({ proposal_id }, ctx) {
    const id = proposal_id ?? ctx.state.pendingProposal?.id;
    if (!id) return { cancelled: null, note: "Nothing was waiting." };
    const r = await ctx.engine("/cancel", { method: "POST", body: { id } });
    ctx.state.pendingProposal = null;
    ctx.directives.push({ type: "cancelled", proposalId: id });
    return r;
  },
};

export const getPortfolio: Tool = {
  name: "get_portfolio",
  description: "Practice account: cash, holdings, gain or loss, and sometimes a habit tip.",
  parameters: { type: "object", properties: {} },
  execute: (_, ctx) => ctx.engine("/portfolio"),
};

export const runBacktest: Tool = {
  name: "run_backtest",
  description: "What if the learner had invested an amount in the past? Returns end value, return, and the worst drop.",
  parameters: {
    type: "object",
    properties: {
      symbol: SYMBOL,
      amount: { type: "number", description: "Dollars invested" },
      start: { type: "string", description: "1m, 3m, 6m, 1y, 2y, or a date YYYY-MM-DD" },
    },
    required: ["symbol"],
  },
  execute: ({ symbol, amount = 1000, start = "1y" }, ctx) =>
    ctx.engine("/backtest", { method: "POST", body: { symbol, amount, start } }),
};

export const reviewTrades: Tool = {
  name: "review_trades",
  description: "The learner's recent practice trades, newest first.",
  parameters: { type: "object", properties: { limit: { type: "number" } } },
  execute: ({ limit = 10 }, ctx) => ctx.engine(`/review${qs({ limit })}`),
};

export const checkTokenBacking: Tool = {
  name: "check_token_backing",
  description: "Compare PVOO's on-chain supply with Sonar's ledger to show every token is backed.",
  parameters: { type: "object", properties: {} },
  execute: (_, ctx) => ctx.engine("/backing"),
};

export const TRADING_TOOLS = [
  listMarkets, getQuote, getPriceHistory, showChart, proposeTrade, confirmTrade,
  cancelTrade, getPortfolio, runBacktest, reviewTrades, checkTokenBacking,
  getOptionQuote, proposeOptionTrade,
];
