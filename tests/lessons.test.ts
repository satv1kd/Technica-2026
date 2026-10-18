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
