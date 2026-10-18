/**
 * The tutor brain: one learner turn in, one spoken reply plus UI directives out.
 *
 * - runTurn: free-form speech or text. Gemini picks tools (up to 5 rounds),
 *   then the reply passes the guardrails and the speech-style filter.
 * - runAction: direct UI actions (Enter to confirm, N/P, quiz keys, menu picks)
 *   that need no model, so they're instant and work even if Gemini is down.
 */
import fs from "node:fs";
import { repoPath } from "../paths";
import type { Lesson } from "../lessons/schema";
import type { ProgressStore } from "../lessons/progress";
import { EngineError, type EngineFetch } from "./engine";
import { callsOf, textOf, type Content, type Generate, type Part } from "./gemini";
import {
  ADVICE_REQUEST,
  NO_ADVICE,
  NO_TRADE_CLAIM,
  checkReply,
  dropUnverified,
  type ToolLogEntry,
} from "./guardrails";
import { toSpeech } from "./speechStyle";
import { declarations, type Directive, type Tool, type ToolContext, type TurnState } from "./tools";

export const MAX_ROUNDS = 5;
const MAX_HISTORY = 24;

export const SYSTEM_PROMPT = fs.readFileSync(repoPath("services", "tutor", "prompts", "system.md"), "utf8");

export interface TutorDeps {
  generate: Generate;
  engine: EngineFetch;
  lessons: Lesson[];
  progress: ProgressStore;
  registry: Map<string, Tool>;
  log?: (msg: string) => void;
}

export interface TurnResult {
  reply: string;
  directives: Directive[];
  state: TurnState;
  history: Content[];
  tools: string[];
  guardrail?: { blocked: boolean; reasons: string[] };
}

function stateNote(state: TurnState): string {
  const notes: string[] = [];
  if (state.pendingProposal) notes.push(`An order is waiting for confirmation (proposal_id ${state.pendingProposal.id}).`);
  if (state.lesson) notes.push(`The learner is in lesson ${state.lesson.id}, step ${state.lesson.step + 1}.`);
  if (state.quiz) notes.push(`A quiz for lesson ${state.quiz.lessonId} is open.`);
  return notes.length ? `\n\n[App state: ${notes.join(" ")}]` : "";
}

function ctxFor(deps: TutorDeps, state: TurnState, transcript: string, userConfirmed: boolean): ToolContext {
  return {
    engine: deps.engine,
    lessons: deps.lessons,
    progress: deps.progress,
    state: structuredClone(state ?? {}),
    transcript,
    userConfirmed,
    directives: [],
  };
}

async function execute(tool: Tool | undefined, name: string, args: Record<string, any>, ctx: ToolContext): Promise<ToolLogEntry> {
  if (!tool) return { tool: name, args, error: `Unknown tool ${name}` };
  try {
    return { tool: name, args, result: await tool.execute(args, ctx) };
  } catch (err) {
    const e = err as Error;
    return { tool: name, args, error: e instanceof EngineError ? `${e.code}: ${e.message}` : e.message };
  }
}

export async function runTurn(
  deps: TutorDeps,
  input: { transcript: string; history?: Content[]; state?: TurnState },
): Promise<TurnResult> {
  const transcript = input.transcript.trim();
  const ctx = ctxFor(deps, input.state ?? {}, transcript, false);
  const advice = ADVICE_REQUEST.test(transcript);
  const userText =
    transcript +
    stateNote(ctx.state) +
    (advice ? "\n\n[The learner is asking for personal advice. Sonar teaches; it doesn't recommend.]" : "");

  const contents: Content[] = [...(input.history ?? []), { role: "user", parts: [{ text: userText }] }];
  const decls = declarations(deps.registry);
  const toolLog: ToolLogEntry[] = [];
  let text = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { parts } = await deps.generate({ system: SYSTEM_PROMPT, contents, tools: decls });
    const calls = callsOf(parts);
    if (!calls.length) {
      text = textOf(parts);
      contents.push({ role: "model", parts: [{ text }] });
      break;
    }
    contents.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const call of calls) {
      const tool = deps.registry.get(call.name);
      const entry = await execute(tool, call.name, call.args ?? {}, ctx);
      toolLog.push(entry);
      const forModel = entry.error ? { error: entry.error } : tool?.forModel ? tool.forModel(entry.result) : entry.result;
      responses.push({ functionResponse: { name: call.name, response: { result: forModel } } });
    }
    contents.push({ role: "user", parts: responses });
    if (ctx.verbatim) break; // lesson narration is spoken word for word
  }

  if (ctx.verbatim) {
    contents.push({ role: "model", parts: [{ text: ctx.verbatim }] });
    return finish(ctx, ctx.verbatim, contents, toolLog);
  }

  if (!text) {
    // Out of tool rounds: ask for words only.
    const { parts } = await deps.generate({ system: SYSTEM_PROMPT, contents });
    text = textOf(parts);
    contents.push({ role: "model", parts: [{ text }] });
  }

  let check = checkReply(text, toolLog, transcript);
  const blocked = !check.ok;
  if (!check.ok) {
    deps.log?.(`[guardrail] blocked: ${check.reasons.join("; ")} :: ${text}`);
    const { parts } = await deps.generate({
      system: SYSTEM_PROMPT,
      contents: [
        ...contents,
        {
          role: "user",
          parts: [{ text: `[Rewrite your last reply. Problems: ${check.reasons.join("; ")}. Use only numbers from your tool results in this turn. Don't recommend investments. Don't say a trade happened unless confirm_trade succeeded.]` }],
        },
      ],
    });
    const retry = textOf(parts);
    const recheck = checkReply(retry, toolLog, transcript);
    if (recheck.ok && retry) {
      text = retry;
    } else {
      deps.log?.(`[guardrail] still blocked after retry: ${recheck.reasons.join("; ")}`);
      if (recheck.reasons.some((r) => r.startsWith("Personalized"))) text = NO_ADVICE;
      else if (recheck.reasons.some((r) => r.startsWith("Trade claimed"))) text = NO_TRADE_CLAIM;
      else text = dropUnverified(retry || text, recheck.unverified) || "I don't have verified numbers for that right now.";
    }
    check = checkReply(text, toolLog, transcript);
    contents[contents.length - 1] = { role: "model", parts: [{ text }] };
  }
  if (advice && !/teaches/i.test(text)) text = `${NO_ADVICE} ${text}`;

  return finish(ctx, toSpeech(text), contents, toolLog, { blocked, reasons: blocked ? ["retried"] : [] });
}

function finish(
  ctx: ToolContext,
  reply: string,
  contents: Content[],
  toolLog: ToolLogEntry[],
  guardrail?: TurnResult["guardrail"],
): TurnResult {
  return {
    reply,
    directives: ctx.directives,
    state: ctx.state,
    history: trimHistory(contents),
    tools: toolLog.map((t) => (t.error ? `${t.tool}!` : t.tool)),
    guardrail,
  };
}

/** Keep the recent conversation, starting on a plain user message. */
export function trimHistory(contents: Content[]): Content[] {
  let h = contents.slice(-MAX_HISTORY);
  const start = h.findIndex((c) => c.role === "user" && c.parts.every((p) => "text" in p));
  h = start >= 0 ? h.slice(start) : [];
  return h;
}

export type UiAction =
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "repeat_step" }
  | { type: "start_lesson"; lesson: string }
  | { type: "quiz_answer"; choice: number | string }
  | { type: "tool"; name: string; args?: Record<string, unknown> };

const SAY_FALLBACK: Record<string, (r: any) => string> = {
  get_portfolio: (r) =>
    `You have ${r.cash} dollars in practice cash` +
    (r.holdings.length ? `, and holdings worth ${r.invested} dollars.` : ", and no holdings yet.") +
    (r.tip ? ` ${r.tip}` : ""),
  check_token_backing: (r) => r.spoken,
  propose_trade: (r) => r.readback,
  cancel_trade: () => "Cancelled. Nothing was traded.",
};

/** Deterministic UI actions. No model call. */
export async function runAction(deps: TutorDeps, action: UiAction, state: TurnState = {}): Promise<TurnResult> {
  const ctx = ctxFor(deps, state, "", action.type === "confirm");
  const call = (name: string, args: Record<string, unknown> = {}) =>
    execute(deps.registry.get(name), name, args, ctx);

  let entry: ToolLogEntry;
  switch (action.type) {
    case "confirm":
      entry = ctx.state.lesson && ctx.state.pendingProposal
        ? await call("confirm_lesson_trade")
        : await call("confirm_trade", { proposal_id: ctx.state.pendingProposal?.id });
      break;
    case "cancel":
      entry = await call("cancel_trade");
      break;
    case "next":
    case "prev":
    case "repeat_step":
      entry = await call("next_step", { direction: action.type === "prev" ? "previous" : action.type === "next" ? "next" : "repeat" });
      break;
    case "start_lesson":
      entry = await call("start_lesson", { lesson: action.lesson });
      break;
    case "quiz_answer":
      entry = await call("answer_quiz", { answer: String(action.choice) });
      break;
    case "tool":
      entry = await call(action.name, action.args ?? {});
      break;
  }

  let reply: string;
  if (entry.error) reply = toSpeech(entry.error.replace(/^\w+: /, ""));
  else if (ctx.verbatim) reply = ctx.verbatim;
  else if (entry.tool === "confirm_trade") {
    const t = entry.result as any;
    reply = toSpeech(`Done. ${t.trade.side === "buy" ? "You bought" : "You sold"} ${t.trade.quantity} ${t.trade.symbol} with practice money. ${t.settlement.note}`);
  } else reply = toSpeech(SAY_FALLBACK[entry.tool]?.(entry.result) ?? "Done.");

  return finish(ctx, reply, [], [entry]);
}
