import { describe, expect, it } from "vitest";
import { runAction } from "@services/tutor/loop";
import { loadCurriculum } from "@services/lessons/loader";
import { fillSay, playStep, UNAVAILABLE } from "@services/lessons/player";
import { gradeQuiz, matchChoice } from "@services/lessons/quiz";
import { mergeProgress, nextLesson } from "@services/lessons/progress";
import { deps, fakeEngine, scripted } from "./fakes";
import type { TurnState } from "@services/tutor/tools";

const lessons = loadCurriculum();
const byId = (id: string) => lessons.find((l) => l.id === id)!;

describe("quiz", () => {
  it("grades number keys", () => {
    expect(gradeQuiz(byId("feel-a-graph"), 2).correct).toBe(true);
    expect(gradeQuiz(byId("feel-a-graph"), 1).correct).toBe(false);
    expect(gradeQuiz(byId("feel-a-graph"), 1).explanation).toMatch(/^Not quite\..*Try again\.$/);
  });

  it("matches spoken answers", () => {
    const opts = ["The left side", "The right side", "The center"];
    expect(matchChoice(opts, "the right side I think")).toBe(1);
    expect(matchChoice(opts, "right")).toBe(1);
    expect(matchChoice(opts, "number two")).toBe(1);
    expect(matchChoice(opts, "the first one")).toBe(0);
    expect(matchChoice(opts, "um")).toBeNull();
  });
});

describe("progress", () => {
  it("up next is the first unfinished core lesson", () => {
    expect(nextLesson(lessons, {})).toBe("feel-a-graph");
    expect(nextLesson(lessons, { "feel-a-graph": { done: true, bestStep: 2 } })).toBe("etf");
  });

  it("merging keeps done and the furthest step", () => {
    expect(mergeProgress({ a: { done: true, bestStep: 1 } }, { a: { done: false, bestStep: 3 } })).toEqual({
      a: { done: true, bestStep: 3 },
    });
  });
});

describe("placeholders", () => {
  it("fills from tool results", () => {
    const runs = [{ tool: "get_price_history", args: { symbol: "AAPL" }, result: { points: [{ close: 100 }, { close: 103.6 }] } }];
    expect(fillSay("It's {AAPL.dir_1m} about {AAPL.pct_1m} percent.", runs).text).toBe("It's up about 3.6 percent.");
  });

  it("drops the sentence and says so when data is missing", () => {
    const r = fillSay("Here's Apple. It's {AAPL.dir_1m} about {AAPL.pct_1m} percent. The tap marks the peak.", []);
    expect(r.text).toBe(`Here's Apple. The tap marks the peak. ${UNAVAILABLE}`);
    expect(r.unavailable).toBe(true);
  });
});

describe("playing lessons", () => {
  it("lesson 2 step 1 resolves Apple's numbers and draws the chart with a peak tap", async () => {
    const { engine } = fakeEngine();
    const d = deps(scripted([]).generate, engine);
    const r = await runAction(d, { type: "start_lesson", lesson: "2" });
    const step = r.directives.find((x) => x.type === "lesson") as any;
    expect(step.step.say).toContain("It's up about 3.6 percent");
    expect(step.step.say).toMatch(/Press N for the next step, or R to repeat\.$/);
    expect(r.reply).toBe(step.step.say);
    const chart = r.directives.find((x) => x.type === "chart") as any;
    expect(chart.chart.ops.filter((o: any) => o.op === "tap")).toHaveLength(1);
    expect(r.state.lesson).toEqual({ id: "etf", step: 0 });
  });

  it("walks lesson 1 with N and P, then the quiz, and records progress", async () => {
    const { engine } = fakeEngine();
    const d = deps(scripted([]).generate, engine);
    let state: TurnState = {};
    const act = async (a: any) => {
      const r = await runAction(d, a, state);
      state = r.state;
      return r;
    };
    expect((await act({ type: "start_lesson", lesson: "1" })).reply).toMatch(/^Rest your hand palm up/);
    expect((await act({ type: "next" })).reply).toMatch(/^Now a line that climbs/);
    expect((await act({ type: "prev" })).reply).toMatch(/^Rest your hand/);
    await act({ type: "next" });
    const last = await act({ type: "next" });
    expect(last.reply).toMatch(/Press N for the quiz/);
    const quiz = await act({ type: "next" });
    expect(quiz.reply).toMatch(/^Quiz time\. Where on your palm is today\? 1: The left side\./);
    expect(state.quiz).toEqual({ lessonId: "feel-a-graph" });

    const wrong = await act({ type: "quiz_answer", choice: 1 });
    expect(wrong.reply).toMatch(/^Not quite/);
    const right = await act({ type: "quiz_answer", choice: "the right side" });
    expect(right.reply).toMatch(/^That's right\..*Up next: Stocks vs\. ETFs/);
    expect((await d.progress.get())["feel-a-graph"].done).toBe(true);
  });

  it("a lesson trade waits for Enter, then narrates", async () => {
    const { engine, calls } = fakeEngine();
    const d = deps(scripted([]).generate, engine);
    const lesson = byId("first-trade");
    const view = await playStep(lesson, lessons, 2, async (tool, args) => d.registry.get(tool)!.execute(args, {
      engine, lessons, progress: d.progress, state: {}, transcript: "", userConfirmed: false, directives: [],
    }));
    expect(view.awaitingConfirm?.id).toBe("p1");
    expect(view.say).toMatch(/^Buy 1 of VOO/);
    expect(calls.some((c) => c.path === "/confirm")).toBe(false);

    const r = await runAction(d, { type: "confirm" }, { lesson: { id: "first-trade", step: 2 }, pendingProposal: { id: "p1" } });
    expect(r.reply).toMatch(/^Done\. You own one share of VOO with practice money/);
    expect(calls.filter((c) => c.path === "/confirm")).toHaveLength(1);
  });

  it("PVOO lesson doesn't claim an on-chain time when settlement was simulated", async () => {
    const { engine } = fakeEngine({
      "/confirm": { trade: { id: "p1", side: "buy", symbol: "PVOO", quantity: 2 }, settlement: { kind: "simulated", note: "Solana devnet didn't answer in time, so this trade was recorded on Sonar's ledger only, as a simulated settlement.", settle_ms: null } },
    });
    const d = deps(scripted([]).generate, engine);
    const r = await runAction(d, { type: "confirm" }, { lesson: { id: "pvoo", step: 2 }, pendingProposal: { id: "p1" } });
    expect(r.reply).toMatch(/^Done\. Solana devnet didn't answer in time/);
    expect(r.reply).not.toMatch(/settled in/);
  });

  it("the backtest lesson speaks the result and the worst drop", async () => {
    const { engine } = fakeEngine();
    const d = deps(scripted([]).generate, engine);
    const r = await runAction(d, { type: "next" }, { lesson: { id: "backtest", step: 1 } });
    expect(r.reply).toMatch(/The biggest fall along the way was 9\.1 percent, around March 30\./);
  });

  it("fee lesson computes about a quarter less over 30 years", async () => {
    const { engine } = fakeEngine();
    const d = deps(scripted([]).generate, engine);
    const fees = await d.registry.get("explain_fees")!.execute({}, {} as any);
    expect(fees.pct_less).toBeGreaterThan(20);
    expect(fees.pct_less).toBeLessThan(30);
    expect(fees.curves.low.at(-1).y).toBe(1);
  });
});
