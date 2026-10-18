/**
 * Guardrails on model-written replies (lesson narration is template-filled
 * and spoken verbatim, so it doesn't pass through here).
 *
 *  1. Every number must trace to a tool result from this turn (with rounding),
 *     to the learner's own words, or to a small allowlist.
 *  2. No personalized advice.
 *  3. No claiming a trade happened without a successful confirm_trade.
 */

import { sentences } from "../text/sentences";

export interface ToolLogEntry {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface CheckResult {
  ok: boolean;
  reasons: string[];
  unverified: string[];
}

// A number plus any unit that makes it a fact: "$560", "3.5%", "12 percent", "40 dollars".
const NUM_RE = /-?\$?\d[\d,]*(?:\.\d+)?(?:%|\s(?:percent|dollars?|cents?)\b)?/gi;

// "1,178 dollars and 75 cents" is one amount, the way speech writes $1,178.75.
const DOLLARS_AND_CENTS = /(\d[\d,]*)\s+dollars?\s+and\s+(\d{1,2})\s+cents?\b/gi;

export function extractNumbers(text: string): string[] {
  const joined = text.replace(DOLLARS_AND_CENTS, (_, d, c) => `$${d}.${c.padStart(2, "0")}`);
  return (joined.match(NUM_RE) ?? []).filter((t) => /\d/.test(t));
}

const numeric = (token: string) => token.match(/-?[\d,]*\.?\d+/)?.[0].replace(/,/g, "") ?? "";
const parse = (token: string) => Number(numeric(token));
const decimals = (token: string) => numeric(token).split(".")[1]?.length ?? 0;

/** All numbers inside a JSON value, including numbers written inside strings. */
export function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(value);
  else if (typeof value === "string") extractNumbers(value).forEach((t) => out.push(parse(t)));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/** Teaching constants Sonar may say without a tool: "the S&P 500", "60 seconds". */
const ALLOWED = new Set([500, 60]);

/** Does the spoken token round from some known value? */
export function traces(token: string, known: number[]): boolean {
  const v = parse(token);
  if (!Number.isFinite(v)) return true;
  // Bare counts ("two steps", "1 share") and years are fine; money and
  // percentages never get this pass, since those are the facts that matter.
  const bare = !/[$%]|percent|dollar|cent/i.test(token) && !token.includes(".");
  if (bare && Number.isInteger(v) && Math.abs(v) <= 10) return true;
  if (bare && v >= 1990 && v <= 2100) return true;
  if (bare && ALLOWED.has(Math.abs(v))) return true;
  const tol = 0.5 * 10 ** -decimals(token) + 1e-9;
  return known.some((k) => {
    for (const cand of [k, Math.abs(k), k * 100, Math.abs(k) * 100]) {
      if (Math.abs(Math.abs(v) - cand) <= tol) return true;
      // Rounded to whole numbers or tens when spoken ("about 702", "about 1,150").
      if (decimals(token) === 0 && Math.abs(v) >= 100 && Math.abs(Math.abs(v) - cand) <= Math.abs(v) * 0.005) return true;
    }
    return false;
  });
}

export const ADVICE_REQUEST =
  /\b(should i (buy|sell|invest|get|put)|what should i (buy|invest|do with)|is (it|\w+) a good (investment|buy|stock|idea)|best (stock|investment|etf|fund)s? (for me|to buy)|(recommend|suggest) (a|an|some|which)|where should i (invest|put))\b/i;

const ADVICE_REPLY =
  /\b(you should (definitely )?(buy|sell|invest)|i('d| would)? (recommend|suggest) (buying|selling|investing|you)|(is|looks like) a (great|good) buy|buy now)\b/i;

const TRADE_CLAIM =
  /\b(you('ve| have)? (just )?(bought|sold|purchased)|i('ve| have)? (bought|sold|placed)|(order|trade) (is|was|has been) (placed|filled|completed|done|executed)|purchase (is|was) complete)\b/i;

export function checkReply(reply: string, log: ToolLogEntry[], transcript = ""): CheckResult {
  const reasons: string[] = [];
  const known = [...log.flatMap((e) => numbersIn(e.result)), ...log.flatMap((e) => numbersIn(e.args)), ...numbersIn(transcript)];

  const unverified = extractNumbers(reply).filter((t) => !traces(t, known));
  if (unverified.length) reasons.push(`Numbers not found in this turn's tool results: ${unverified.join(", ")}`);

  if (ADVICE_REPLY.test(reply)) reasons.push("Personalized advice detected");

  const confirmed = log.some((e) => e.tool === "confirm_trade" && e.result && !e.error);
  const lookedUp = log.some((e) => ["review_trades", "get_portfolio"].includes(e.tool) && e.result);
  if (TRADE_CLAIM.test(reply) && !confirmed && !lookedUp) reasons.push("Trade claimed without a confirmed trade");

  return { ok: reasons.length === 0, reasons, unverified };
}

/** Last resort: drop sentences that fail the number check. */
export function dropUnverified(reply: string, unverified: string[]): string {
  if (!unverified.length) return reply;
  return sentences(reply).filter((s) => !unverified.some((u) => s.includes(u))).join(" ").trim();
}

export const NO_ADVICE =
  "Sonar teaches investing concepts. I can't recommend specific investments for your situation.";
export const NO_TRADE_CLAIM = "I can't confirm that trade without a confirmation in my records.";
