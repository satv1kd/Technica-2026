import { describe, expect, it } from "vitest";
import { loadCurriculum } from "@services/lessons/loader";
import { placeholders } from "@services/lessons/schema";
import { UNAVAILABLE, fillSay } from "@services/lessons/player";

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
      "AAPL.dir_1m", "AAPL.pct_1m", "VOO.price", "backing_verdict", "cash", "dd_date", "end_value",
      "ledger", "max_dd", "return_pct", "settle_s", "supply", "value",
    ]);
  });
});

describe("filling narration", () => {
  const backingSay = loadCurriculum().find((l) => l.id === "pvoo")!.steps.find((s) => s.id === "pvoo-4")!.say;
  const backing = (matches: boolean) => [
    { tool: "check_token_backing", args: {}, result: { supply: 2, ledger_onchain: matches ? 2 : 3, matches } },
  ];

  it("only says the tokens are backed when the check says so", () => {
    expect(fillSay(backingSay, backing(true)).text).toContain("They match, so every token is backed.");
    const mismatch = fillSay(backingSay, backing(false)).text;
    expect(mismatch).toContain("They don't match");
    expect(mismatch).not.toContain("every token is backed");
  });

  it("makes no backing claim when the chain can't be reached", () => {
    const r = fillSay(backingSay, [{ tool: "check_token_backing", args: {}, error: "chain_unavailable" }]);
    expect(r.unavailable).toBe(true);
    expect(r.text).not.toMatch(/match|backed/);
    expect(r.text).toContain(UNAVAILABLE);
  });

  it("writes money as spoken words, not $ signs", () => {
    const run = [{ tool: "run_backtest", args: {}, result: { end_value: 1147.55, return_pct: 14.75 } }];
    expect(fillSay("It would be worth {end_value} today.", run).text).toBe("It would be worth 1,147.55 dollars today.");
    const cash = [{ tool: "get_portfolio", args: {}, result: { cash: 10000, holdings: [] } }];
    expect(fillSay("You have {cash} in practice cash.", cash).text).toBe("You have 10,000 dollars in practice cash.");
  });
});
