/**
 * Plays one lesson step: fetches its data through tools, fills placeholders,
 * and builds the chart ops, so narration and drawing start together.
 */
import { opsFromEngineChart, opsFromShape, type ChartOps, type ChartOp } from "../chart/ops";
import { sentences } from "../text/sentences";
import { placeholders, type Lesson, type Step } from "./schema";

export type CallTool = (tool: string, args: Record<string, unknown>) => Promise<any>;

interface ToolRun {
  tool: string;
  args: Record<string, unknown>;
  result?: any;
  error?: string;
}

export interface Proposal {
  id: string;
  readback: string;
  [k: string]: unknown;
}

export interface StepView {
  lessonId: string;
  lessonTitle: string;
  lessonNumber: number;
  lessonCount: number;
  stepIndex: number;
  stepCount: number;
  title: string;
  say: string;
  chart: ChartOps | null;
  /** Set when the step is waiting for the learner to confirm a trade. */
  awaitingConfirm: Proposal | null;
  isLast: boolean;
  dataUnavailable: boolean;
}

export const NEXT_HINT = "Press N for the next step, or R to repeat.";
export const QUIZ_HINT = "Press N for the quiz, or R to repeat.";
export const UNAVAILABLE = "The current data is unavailable.";

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = (n: number) => String(Number(n.toFixed(6)));
const spokenDate = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

function find(runs: ToolRun[], tool: string, symbol?: string) {
  return runs.find(
    (r) => r.tool === tool && r.result && (!symbol || String(r.args.symbol).toUpperCase() === symbol),
  )?.result;
}

/** Value for one placeholder, or undefined if its data isn't available. */
export function resolvePlaceholder(name: string, runs: ToolRun[]): string | undefined {
  const sym = /^([A-Z]+)\.(\w+)$/.exec(name);
  if (sym) {
    const [, symbol, field] = sym;
    if (field === "price") {
      const q = find(runs, "get_quote", symbol);
      return q ? q.price.toFixed(2) : undefined;
    }
    const h = find(runs, "get_price_history", symbol);
    if (!h?.points?.length) return undefined;
    const first = h.points[0].close, last = h.points.at(-1).close;
    const pct = ((last - first) / first) * 100;
    if (field.startsWith("dir")) return Math.abs(pct) < 1 ? "nearly flat, changing" : pct > 0 ? "up" : "down";
    if (field.startsWith("pct")) return Math.abs(pct).toFixed(1);
    return undefined;
  }
  const portfolio = find(runs, "get_portfolio");
  const backing = find(runs, "check_token_backing");
  const backtest = find(runs, "run_backtest");
  const confirm = find(runs, "confirm_trade");
  switch (name) {
    case "cash":
      return portfolio ? money(portfolio.cash) : undefined;
    case "value": {
      const h = portfolio?.holdings?.find((x: any) => x.symbol === "VOO");
      return h ? money(h.price) : undefined;
    }
    case "settle_s": {
      const ms = confirm?.settlement?.settle_ms;
      return confirm?.settlement?.kind === "onchain" && typeof ms === "number" ? (ms / 1000).toFixed(1) : undefined;
    }
    case "supply":
      return backing ? trim(backing.supply) : undefined;
    case "ledger":
      return backing ? trim(backing.ledger_onchain) : undefined;
    case "end_value":
      return backtest ? money(backtest.end_value) : undefined;
    case "return_pct":
      return backtest ? backtest.return_pct.toFixed(1) : undefined;
    case "max_dd":
      return backtest ? Math.abs(backtest.max_drawdown_pct).toFixed(1) : undefined;
    case "dd_date":
      return backtest ? spokenDate(backtest.drawdown_trough_date) : undefined;
  }
  return undefined;
}

/** Fill placeholders. Sentences whose data is missing are dropped, then flagged. */
export function fillSay(say: string, runs: ToolRun[]): { text: string; unavailable: boolean } {
  let unavailable = false;
  const kept = sentences(say).flatMap((s) => {
    let ok = true;
    const filled = s.replace(/\{([^{}]+)\}/g, (_, name) => {
      const v = resolvePlaceholder(name, runs);
      if (v === undefined) ok = false;
      return v ?? "";
    });
    if (!ok) unavailable = true;
    return ok ? [filled.trim()] : [];
  });
  const text = kept.join(" ");
  return { text: unavailable ? `${text} ${UNAVAILABLE}`.trim() : text, unavailable };
}

async function run(call: CallTool, tool: string, args: Record<string, unknown>): Promise<ToolRun> {
  try {
    return { tool, args, result: await call(tool, args) };
  } catch (err) {
    return { tool, args, error: (err as Error).message };
  }
}

async function buildChart(step: Step, runs: ToolRun[], call: CallTool): Promise<ChartOps | null> {
  const c = step.chart;
  if (!c) return null;
  if (c.shape) return opsFromShape(c.shape, step.alt ?? "");
  if (c.series[0]?.startsWith("fee-")) {
    const fees = find(runs, "explain_fees");
    if (!fees) return null;
    const ops: ChartOp[] = [
      { op: "stroke", points: fees.curves.low, style: "solid", label: `${fees.low_fee}% fee` },
      { op: "pause", ms: 600 },
      { op: "stroke", points: fees.curves.high, style: "dashed", label: `${fees.high_fee}% fee` },
    ];
    return {
      ops,
      alt: step.alt ?? "",
      legend: [
        { label: `${fees.low_fee}% fee`, style: "solid" },
        { label: `${fees.high_fee}% fee`, style: "dashed" },
      ],
    };
  }
  if (!c.series.length) return null;
  const range =
    (step.data?.find((d) => d.args.range)?.args.range as string | undefined) ??
    (step.data?.find((d) => d.args.start)?.args.start as string | undefined) ??
    "1m";
  const r = await run(call, "show_chart", {
    symbols: c.series,
    range,
    points: c.points ?? 12,
    markers: c.markers ?? [],
  });
  if (!r.result) return null;
  return opsFromEngineChart(r.result.chart, c.markers ?? [], step.alt);
}

function view(lesson: Lesson, lessons: Lesson[], i: number): Omit<StepView, "say" | "chart" | "awaitingConfirm" | "dataUnavailable"> {
  const core = lessons.filter((l) => !l.stretch);
  return {
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    lessonNumber: lessons.indexOf(lesson) + 1,
    lessonCount: core.length,
    stepIndex: i,
    stepCount: lesson.steps.length,
    title: lesson.steps[i].title,
    isLast: i === lesson.steps.length - 1,
  };
}

function lastProposeArgs(lesson: Lesson, upTo: number) {
  for (let i = upTo; i >= 0; i--) {
    const a = lesson.steps[i].action?.findLast((x) => x.tool === "propose_trade");
    if (a) return a.args;
  }
  return null;
}

export async function playStep(lesson: Lesson, lessons: Lesson[], i: number, call: CallTool): Promise<StepView> {
  const step = lesson.steps[i];
  if (!step) throw new RangeError(`Lesson ${lesson.id} has no step ${i + 1}.`);

  const runs = await Promise.all((step.data ?? []).map((d) => run(call, d.tool, d.args)));
  const actions = step.action ?? [];
  const needsConfirm = actions.some((a) => a.tool === "confirm_trade");

  let proposal: Proposal | null = null;
  for (const a of actions) {
    if (a.tool === "propose_trade") {
      const r = await run(call, a.tool, a.args);
      runs.push(r);
      proposal = r.result ?? null;
    }
  }
  if (needsConfirm) {
    if (!proposal) {
      const args = lastProposeArgs(lesson, i);
      const r = args ? await run(call, "propose_trade", args) : null;
      proposal = r?.result ?? null;
    }
    if (!proposal) {
      return { ...view(lesson, lessons, i), say: `I couldn't get a price right now. ${UNAVAILABLE}`, chart: null, awaitingConfirm: null, dataUnavailable: true };
    }
    // Narration waits for the learner's confirm; read the order back first.
    return { ...view(lesson, lessons, i), say: proposal.readback, chart: null, awaitingConfirm: proposal, dataUnavailable: false };
  }

  const { text, unavailable } = fillSay(step.say, runs);
  const readback = proposal ? ` ${proposal.readback}` : "";
  const v = view(lesson, lessons, i);
  return {
    ...v,
    say: `${text}${readback} ${v.isLast ? QUIZ_HINT : NEXT_HINT}`,
    chart: await buildChart(step, runs, call),
    awaitingConfirm: null,
    dataUnavailable: unavailable,
  };
}

/** Called after the learner confirms a trade in a lesson step. */
export async function confirmStep(
  lesson: Lesson,
  lessons: Lesson[],
  i: number,
  proposalId: string,
  call: CallTool,
): Promise<StepView & { trade: any }> {
  const step = lesson.steps[i];
  const confirm = await run(call, "confirm_trade", { proposal_id: proposalId });
  if (!confirm.result) {
    return {
      ...view(lesson, lessons, i),
      say: `${confirm.error ?? "That trade didn't go through."} Press R to hear the order again.`,
      chart: null, awaitingConfirm: null, dataUnavailable: true, trade: null,
    };
  }
  const runs = [confirm, ...(await Promise.all((step.data ?? []).map((d) => run(call, d.tool, d.args))))];
  const settlement = confirm.result.settlement;
  let say = step.say;
  if (placeholders(say).includes("settle_s") && settlement?.kind !== "onchain") {
    // Don't claim an on-chain settlement time that didn't happen.
    say = `Done. ${settlement?.note ?? ""}`;
  }
  const { text, unavailable } = fillSay(say, runs);
  const v = view(lesson, lessons, i);
  return {
    ...v,
    say: `${text} ${v.isLast ? QUIZ_HINT : NEXT_HINT}`,
    chart: await buildChart(step, runs, call),
    awaitingConfirm: null,
    dataUnavailable: unavailable,
    trade: confirm.result,
  };
}
