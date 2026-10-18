import { describe, expect, it } from "vitest";
import { DOUBLE_TAP, answerView, dashStates, lessonHeader } from "@web/lib/answer";
import { mergeDone } from "@web/lib/progressCache";
import { DEFAULT_LESSONS } from "@web/lib/tray";
import type { StepView } from "@services/lessons/player";

const step = (i: number, extra: Partial<StepView> = {}): StepView => ({
  lessonId: "etf", lessonTitle: "Stocks vs. ETFs", lessonNumber: 2, lessonCount: 5,
  stepIndex: i, stepCount: 4, title: "t", say: "s", chart: null, awaitingConfirm: null,
  isLast: i === 3, dataUnavailable: false, ...extra,
});

describe("answer view", () => {
  it("a plain reply is an answer", () => {
    expect(answerView([], null).kind).toBe("answer");
  });

  it("a lesson step shows the lesson header", () => {
    const v = answerView([{ type: "lesson", step: step(0) }], null);
    expect(v.kind).toBe("lesson");
    expect(v.lesson?.stepIndex).toBe(0);
  });

  it("a lesson step waiting for a trade asks to confirm", () => {
    const proposal = { id: "p1", readback: "Buy 1 VOO." };
    expect(answerView([{ type: "lesson", step: step(2, { awaitingConfirm: proposal }) }], null).kind).toBe("confirm");
    expect(answerView([{ type: "confirm", proposal }], null).proposal).toEqual(proposal);
  });

  it("opens a quiz, keeps it for a retry, and double-taps on a correct answer", () => {
    const open = answerView([{ type: "quiz", lessonId: "etf", question: "Q?", options: ["a", "b", "c"] }], null);
    expect(open.kind).toBe("quiz");
    expect(open.quiz).toMatchObject({ question: "Q?", result: null });

    const wrong = answerView(
      [{ type: "quiz_result", lessonId: "etf", result: { correct: false, chosen: 1, correctIndex: 0, explanation: "x" }, nextLessonId: null }],
      open.quiz,
    );
    expect(wrong.kind).toBe("quiz");
    expect(wrong.quiz?.result?.correct).toBe(false);
    expect(wrong.chart).toBeNull();

    const right = answerView(
      [{ type: "quiz_result", lessonId: "etf", result: { correct: true, chosen: 0, correctIndex: 0, explanation: "y" }, nextLessonId: "first-trade" }],
      wrong.quiz,
    );
    expect(right.quiz?.result?.correct).toBe(true);
    expect(right.chart).toBe(DOUBLE_TAP);
    expect(right.nextLessonId).toBe("first-trade");
    expect(DOUBLE_TAP.ops.filter((o) => o.op === "tap")).toHaveLength(2);
  });

  it("formats the lesson header and progress dashes", () => {
    expect(lessonHeader(step(0))).toBe("Lesson 2 of 5 · Step 1 of 4");
    expect(dashStates(step(2))).toEqual(["done", "done", "current", "future"]);
  });
});

describe("progress cache", () => {
  it("marks locally finished lessons done and moves Up next", () => {
    const merged = mergeDone(DEFAULT_LESSONS, ["feel-a-graph"]);
    expect(merged[0]).toMatchObject({ done: true, upNext: false });
    expect(merged[1]).toMatchObject({ done: false, upNext: true });
  });
});
