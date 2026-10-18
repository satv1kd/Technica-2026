import { describe, expect, it } from "vitest";
import { loadCurriculum } from "@services/lessons/loader";
import { placeholders } from "@services/lessons/schema";

describe("curriculum", () => {
  const lessons = loadCurriculum();

  it("loads 5 core lessons and 1 stretch lesson", () => {
    expect(lessons).toHaveLength(6);
    expect(lessons.filter((l) => l.stretch)).toHaveLength(1);
  });

  it("every quiz answer indexes into its options", () => {
    for (const l of lessons) {
      expect(l.quiz.answer).toBeLessThan(l.quiz.options.length);
    }
  });

  it("every placeholder step declares a data or action source", () => {
    for (const l of lessons) {
      for (const s of l.steps) {
        if (placeholders(s.say).length > 0) {
          expect(s.data?.length || s.action?.length, `${s.id} has placeholders`).toBeTruthy();
        }
      }
    }
  });
});

describe("placeholders", () => {
  it("extracts dotted and plain placeholders in order", () => {
    expect(placeholders("It's {AAPL.dir_1m} about {AAPL.pct_1m} percent, {cash} left.")).toEqual([
      "AAPL.dir_1m",
      "AAPL.pct_1m",
      "cash",
    ]);
  });

  it("returns nothing for plain text", () => {
    expect(placeholders("No numbers here.")).toEqual([]);
  });

  it("every lesson has 1 to 6 steps and one quiz", () => {
    for (const l of loadCurriculum()) {
      expect(l.steps.length).toBeGreaterThanOrEqual(1);
      expect(l.steps.length).toBeLessThanOrEqual(6);
      expect(l.quiz.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("documents every placeholder the curriculum uses", () => {
    const all = new Set(loadCurriculum().flatMap((l) => l.steps.flatMap((s) => placeholders(s.say))));
    expect([...all].sort()).toEqual([
      "AAPL.dir_1m", "AAPL.pct_1m", "VOO.price", "cash", "dd_date", "end_value",
      "ledger", "max_dd", "return_pct", "settle_s", "supply", "value",
    ]);
  });
});
