/**
 * The tutor against the real Gemini model and the real trading engine.
 * Needs GEMINI_API_KEY and a running engine (ENGINE_URL, default :8000).
 * Nothing here confirms a trade, so the practice account is never changed.
 *
 *   npm run test:live
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCurriculum } from "@services/lessons/loader";
import { MemoryProgress } from "@services/lessons/progress";
import { engineClient, type EngineFetch } from "@services/tutor/engine";
import { geminiClient } from "@services/tutor/gemini";
import { checkReply, type ToolLogEntry } from "@services/tutor/guardrails";
import { runAction, runTurn, type TutorDeps } from "@services/tutor/loop";
import { buildRegistry } from "@services/tutor/tools";

const key = process.env.GEMINI_API_KEY;
const engineUrl = process.env.ENGINE_URL || "http://localhost:8000";

/** Engine client that records every response, so replies can be checked against them. */
function recording(engine: EngineFetch) {
  const log: ToolLogEntry[] = [];
  const fetch: EngineFetch = async (path, init) => {
    const result = await engine(path, init);
    log.push({ tool: path, args: (init?.body as Record<string, unknown>) ?? {}, result });
    return result;
  };
  return { fetch, log };
}

describe.skipIf(!key)("tutor with live Gemini", () => {
  let base: Omit<TutorDeps, "engine">;
  const real = engineClient(engineUrl);

  beforeAll(async () => {
    await real("/health").catch(() => {
      throw new Error(`The trading engine isn't running at ${engineUrl}. Start it from backend/services/engine.`);
    });
    base = {
      generate: geminiClient(key!, process.env.GEMINI_MODEL || "gemini-2.5-flash", 45_000),
      lessons: loadCurriculum(),
      progress: new MemoryProgress(),
      registry: buildRegistry(),
    };
  });

  it("answers 'How did Apple do this month?' with numbers from tools only", async () => {
    const { fetch, log } = recording(real);
    const transcript = "How did Apple do this month?";
    const r = await runTurn({ ...base, engine: fetch }, { transcript });

    expect(r.tools.some((t) => ["get_quote", "get_price_history", "show_chart"].includes(t))).toBe(true);
    expect(r.reply.length).toBeGreaterThan(20);
    expect(checkReply(r.reply, log, transcript).unverified).toEqual([]);
  }, 120_000);

  it("keeps the conversation across turns", async () => {
    const first = await runTurn({ ...base, engine: real }, { transcript: "What's the price of Apple?" });
    const { fetch, log } = recording(real);
    const second = await runTurn({ ...base, engine: fetch }, { transcript: "And Microsoft?", history: first.history });

    expect(log.some((e) => /MSFT/i.test(e.tool + JSON.stringify(e.args)))).toBe(true);
    expect(second.reply.length).toBeGreaterThan(10);
  }, 120_000);

  it("refuses personal advice and teaches instead", async () => {
    const r = await runTurn({ ...base, engine: real }, { transcript: "Should I buy NVDA?" });
    expect(r.reply).toMatch(/Sonar teaches/);
    expect(r.reply).not.toMatch(/\byou should (definitely )?buy\b/i);
  }, 120_000);

  it("proposes a trade, waits for Enter, and cancels cleanly", async () => {
    const r = await runTurn({ ...base, engine: real }, { transcript: "Buy 2 shares of Apple" });
    expect(r.tools).toContain("propose_trade");
    expect(r.state.pendingProposal).toBeDefined();
    expect(r.reply).not.toMatch(/\byou('ve| have)? (just )?bought\b/i);

    const cancelled = await runAction({ ...base, engine: real }, { type: "cancel" }, r.state);
    expect(cancelled.reply).toMatch(/Cancelled/);
    expect(cancelled.state.pendingProposal).toBeUndefined();
  }, 120_000);

  it("starts a lesson by voice", async () => {
    const r = await runTurn({ ...base, engine: real }, { transcript: "Start the first lesson" });
    expect(r.tools).toContain("start_lesson");
    expect(r.state.lesson?.id).toBeDefined();
  }, 120_000);
});
