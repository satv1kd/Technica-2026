import type { EngineFetch } from "@services/tutor/engine";
import { EngineError } from "@services/tutor/engine";
import type { Generate, GenerateRequest, Part } from "@services/tutor/gemini";
import { loadCurriculum } from "@services/lessons/loader";
import { MemoryProgress } from "@services/lessons/progress";
import { buildRegistry } from "@services/tutor/tools";
import type { TutorDeps } from "@services/tutor/loop";

export const AAPL_HISTORY = {
  symbol: "AAPL",
  range: "1m",
  points: [
    { date: "2026-09-16", close: 331.34 },
    { date: "2026-09-29", close: 329.58 },
    { date: "2026-10-16", close: 343.39 },
  ],
};

export const CHART = {
  range: "1m",
  scale: { low: 332.02, high: 342.14 },
  series: [
    {
      symbol: "AAPL",
      smoothing: "sma5",
      points: Array.from({ length: 12 }, (_, i) => ({ x: i / 11, y: i === 6 ? 0 : i / 11, date: "2026-10-01", value: 335 + i })),
      markers: { peak: 11, trough: 6, end: 11 },
      summary: { direction: "up", pct_change: 3.6, first_close: 331.34, last_close: 343.39 },
    },
  ],
};

export function fakeEngine(overrides: Record<string, any> = {}) {
  const calls: { path: string; body?: any }[] = [];
  let cash = 10000;
  let proposalN = 0;
  const engine: EngineFetch = async (path, init = {}) => {
    calls.push({ path, body: init.body });
    const route = path.split("?")[0];
    if (route in overrides) {
      const v = overrides[route];
      if (v instanceof Error) throw v;
      return typeof v === "function" ? v(path, init.body) : v;
    }
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    switch (route) {
      case "/markets":
        return { markets: ["VOO", "AAPL", "PVOO"].map((symbol) => ({ symbol })) };
      case "/quote":
        return { symbol: q.get("symbol"), price: 701.75, as_of: "2026-10-16", market_open: false, note: "The market is closed, so this is the last closing price, from Friday, October 16." };
      case "/history":
        return { ...AAPL_HISTORY, symbol: q.get("symbol") };
      case "/chart":
        return CHART;
      case "/propose": {
        const b = init.body as any;
        const total = 701.75 * Number(b.qty);
        return { id: `p${++proposalN}`, side: b.side, symbol: b.symbol, quantity: Number(b.qty), price: 701.75, total, readback: `Buy ${b.qty} of ${b.symbol} at 701.75 dollars each. Press Enter or say confirm.` };
      }
      case "/confirm": {
        const id = (init.body as any).id;
        cash -= 701.75;
        const symbol = id === "p-pvoo" ? "PVOO" : "VOO";
        return { trade: { id, side: "buy", symbol, quantity: 1, price: 701.75 }, settlement: { kind: "T+1", note: "A regular trade like this settles the next business day.", settle_ms: null }, cash_after: cash };
      }
      case "/cancel":
        return { cancelled: (init.body as any).id };
      case "/portfolio":
        return { cash, holdings: [{ symbol: "VOO", quantity: 1, price: 701.75, value: 701.75 }], invested: 701.75, total_value: cash + 701.75, tip: null };
      case "/backtest":
        return { symbol: "VOO", amount: 1000, end_value: 1147.55, return_pct: 14.8, max_drawdown_pct: -9.1, drawdown_peak_date: "2026-01-27", drawdown_trough_date: "2026-03-30" };
      case "/backing":
        return { supply: 2, ledger_onchain: 2, ledger_simulated: 0, matches: true, spoken: "Supply matches the ledger: 2 tokens on chain, 2 on Sonar's ledger." };
      case "/review":
        return { trades: [] };
    }
    throw new EngineError(404, "not_found", route);
  };
  return { engine, calls };
}

/** Replays a fixed sequence of model turns and records every request. */
export function scripted(turns: Part[][]) {
  const requests: GenerateRequest[] = [];
  const generate: Generate = async (req) => {
    requests.push(structuredClone(req));
    const parts = turns[requests.length - 1] ?? [{ text: "OK." }];
    return { parts };
  };
  return { generate, requests };
}

export const call = (name: string, args: Record<string, unknown> = {}): Part => ({ functionCall: { name, args } });
export const say = (text: string): Part => ({ text });

export function deps(generate: Generate, engine: EngineFetch): TutorDeps & { progress: MemoryProgress } {
  return {
    generate,
    engine,
    lessons: loadCurriculum(),
    progress: new MemoryProgress(),
    registry: buildRegistry(),
  };
}
