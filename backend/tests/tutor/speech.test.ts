import { describe, expect, it } from "vitest";
import {
  RISK_NOTE,
  describeShapes,
  numberToWords,
  speakMoney,
  splitLong,
  stripMarkdown,
  toSpeech,
} from "@services/tutor/speechStyle";
import { ADVICE_REQUEST, checkReply, dropUnverified, extractNumbers, type ToolLogEntry } from "@services/tutor/guardrails";

describe("toSpeech", () => {
  it("matches the task's example exactly", () => {
    expect(toSpeech("VOO is up 12%")).toBe("VOO is up about 12 percent. Remember, prices can fall as well as rise.");
  });

  it("strips markdown", () => {
    expect(stripMarkdown("## Apple\n- **up** a bit\n- see [chart](http://x)")).toBe("Apple up a bit see chart");
  });

  it("speaks money", () => {
    expect(speakMoney("$560")).toBe("five hundred sixty dollars");
    expect(speakMoney("$1,403.50")).toBe("one thousand four hundred three dollars and fifty cents");
    expect(numberToWords(10000)).toBe("ten thousand");
    expect(toSpeech("You have $9,298.25 left.")).toBe(
      "You have nine thousand two hundred ninety-eight dollars and twenty-five cents left.",
    );
  });

  it("keeps an existing hedge on percentages", () => {
    expect(toSpeech("It fell around 9.1% in March.")).toContain("around 9.1 percent");
  });

  it("splits sentences longer than 25 words at a natural break", () => {
    const long =
      "Apple climbed slowly for the first two weeks of the month while the wider market stayed flat, and then it jumped sharply in the final few days before Friday's close.";
    const parts = splitLong(long);
    expect(parts.length).toBe(2);
    for (const p of parts) expect(p.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it("describes shapes, not colors", () => {
    expect(describeShapes("The green line rises while the dashed line stays flat.")).toBe(
      "The line rises while the dashed line stays flat.",
    );
  });

  it("adds the risk note only once and only for returns", () => {
    expect(toSpeech("An ETF holds many companies.")).not.toContain(RISK_NOTE);
    expect(toSpeech("It rose 5%. Prices can fall as well as rise.").match(/fall as well as rise/g)).toHaveLength(1);
  });
});

const log = (tool: string, result: unknown, args = {}): ToolLogEntry => ({ tool, args, result });

describe("guardrails", () => {
  it("blocks a price the tools never returned", () => {
    const r = checkReply("Apple is at $175.", [log("get_quote", { price: 170 })]);
    expect(r.ok).toBe(false);
    expect(r.unverified).toEqual(["$175"]);
  });

  it("allows rounded tool numbers, absolute drawdowns, and percent of fractions", () => {
    const tools = [log("get_quote", { price: 701.745 }), log("run_backtest", { max_drawdown_pct: -9.1, weight: 0.62 })];
    expect(checkReply("VOO is about $702, at 701.75 exactly. It fell 9.1 percent at worst, and holds 62% of the account.", tools).ok).toBe(true);
  });

  it("does not let small percentages slip through as counting words", () => {
    expect(checkReply("Apple is up 5%.", []).ok).toBe(false);
    expect(checkReply("Apple is up 5 percent.", []).ok).toBe(false);
    expect(checkReply("Buying takes 2 steps.", []).ok).toBe(true);
  });

  it("accepts numbers the learner said", () => {
    expect(checkReply("Sure, 1,000 dollars into VOO.", [], "what if I put $1000 in VOO").ok).toBe(true);
  });

  it("detects advice requests and advice replies", () => {
    expect(ADVICE_REQUEST.test("Should I buy NVDA?")).toBe(true);
    expect(ADVICE_REQUEST.test("What is an ETF?")).toBe(false);
    expect(checkReply("You should buy NVDA now.", []).reasons).toContain("Personalized advice detected");
  });

  it("reads 'N dollars and M cents' as one amount", () => {
    const tools = [log("run_backtest", { end_value: 1178.75 })];
    expect(checkReply("It would be worth 1178 dollars and 75 cents now.", tools).ok).toBe(true);
    expect(checkReply("It would be worth 1,178 dollars and 5 cents now.", tools).unverified).toEqual(["$1,178.05"]);
  });

  it("blocks trade claims without a confirmed trade", () => {
    expect(checkReply("Done, you bought two shares.", []).reasons).toContain("Trade claimed without a confirmed trade");
    expect(checkReply("Done, you bought two shares.", [log("confirm_trade", { ok: 1 })]).ok).toBe(true);
  });

  it("extracts numbers with units", () => {
    expect(extractNumbers("Up 3.5% to $1,403.50, or 12 percent, 40 dollars")).toEqual([
      "3.5%", "$1,403.50", "12 percent", "40 dollars",
    ]);
  });

  it("drops only the sentences with unverified numbers", () => {
    expect(dropUnverified("VOO is 701.75. It will hit 900 soon. Neat.", ["900"])).toBe("VOO is 701.75. Neat.");
  });
});
