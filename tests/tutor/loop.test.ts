import { describe, expect, it } from "vitest";
import { buildRegistry, declarations } from "@services/tutor/tools";
import { MAX_ROUNDS, runAction, runTurn } from "@services/tutor/loop";
import { EngineError } from "@services/tutor/engine";
import { call, deps, fakeEngine, say, scripted } from "./fakes";

describe("tool registry", () => {
  const decls = declarations(buildRegistry());

  it("exposes the 16 tools from the PRD to the model", () => {
    expect(decls.map((d) => d.name).sort()).toEqual([
      "answer_quiz", "cancel_trade", "check_token_backing", "confirm_trade", "explain_fees",
      "get_portfolio", "get_price_history", "get_quote", "list_markets", "next_step",
      "propose_trade", "review_trades", "run_backtest", "show_chart", "start_lesson", "suggest_options",
    ]);
  });

  it("every schema is an object whose required fields exist", () => {
    for (const d of decls) {
      expect(d.description.length).toBeGreaterThan(10);
      if (!d.parameters) continue;
      const p = d.parameters as { type: string; properties: object; required?: string[] };
      expect(p.type).toBe("object");
      for (const r of p.required ?? []) expect(Object.keys(p.properties)).toContain(r);
    }
  });
});

describe("runTurn", () => {
  it("answers 'How did Apple do this month?' with tool numbers and a chart", async () => {
    const { engine, calls } = fakeEngine();
    const { generate, requests } = scripted([
      [call("show_chart", { symbols: ["AAPL"], range: "1m" }), call("get_quote", { symbol: "AAPL" })],
      [say("Apple rose about 3.6% this month, ending at $701.75. It dipped near the middle, then climbed.")],
    ]);
    const r = await runTurn(deps(generate, engine), { transcript: "How did Apple do this month?" });

    expect(calls.map((c) => c.path.split("?")[0])).toEqual(["/chart", "/quote"]);
    expect(r.tools).toEqual(["show_chart", "get_quote"]);
    expect(r.directives.find((d) => d.type === "chart")).toBeDefined();
    expect(r.reply).toContain("about 3.6 percent");
    expect(r.reply).toContain("seven hundred one dollars and seventy-five cents");
    expect(r.reply).toMatch(/fall as well as rise/);
    expect(r.guardrail?.blocked).toBe(false);
    // The model got a compact chart summary, not 12 raw points.
    const fr = (requests[1].contents.at(-1)!.parts[0] as any).functionResponse;
    expect(fr.response.result.series[0].pct_change).toBe(3.6);
    expect(fr.response.result.series[0].points).toBeUndefined();
  });

  it("regenerates when the model invents a number", async () => {
    const { engine } = fakeEngine();
    const { generate, requests } = scripted([
      [call("get_quote", { symbol: "VOO" })],
      [say("VOO is at $750 today.")],
      [say("VOO's last close was $701.75.")],
    ]);
    const logs: string[] = [];
    const r = await runTurn({ ...deps(generate, engine), log: (m) => logs.push(m) }, { transcript: "VOO price?" });
    expect(r.reply).toContain("seven hundred one dollars");
    expect(r.reply).not.toContain("seven hundred fifty");
    expect(r.guardrail?.blocked).toBe(true);
    expect(logs[0]).toMatch(/\$750/);
    expect(JSON.stringify(requests[2].contents.at(-1))).toMatch(/Rewrite your last reply/);
  });

  it("drops invented sentences if the retry still invents", async () => {
    const { engine } = fakeEngine();
    const { generate } = scripted([
      [call("get_quote", { symbol: "VOO" })],
      [say("VOO is at $750.")],
      [say("VOO closed at $701.75. Analysts expect $900.")],
    ]);
    const r = await runTurn(deps(generate, engine), { transcript: "VOO?" });
    expect(r.reply).toContain("seven hundred one dollars");
    expect(r.reply).not.toMatch(/nine hundred/);
  });

  it("answers advice requests with the education-only line", async () => {
    const { engine } = fakeEngine();
    const { generate, requests } = scripted([[say("NVDA could be a great buy now.")], [say("You should buy it.")]]);
    const r = await runTurn(deps(generate, engine), { transcript: "Should I buy NVDA?" });
    expect(r.reply).toMatch(/^Sonar teaches investing concepts/);
    expect(JSON.stringify(requests[0].contents)).toMatch(/asking for personal advice/);
  });

  it("stops after 5 tool rounds and asks for words", async () => {
    const { engine } = fakeEngine();
    const looping = Array.from({ length: MAX_ROUNDS }, () => [call("list_markets")]);
    const { generate, requests } = scripted([...looping, [say("Sonar trades seven assets.")]]);
    const r = await runTurn(deps(generate, engine), { transcript: "what can I trade" });
    expect(requests).toHaveLength(MAX_ROUNDS + 1);
    expect(requests.at(-1)!.tools).toBeUndefined();
    expect(r.reply).toBe("Sonar trades seven assets.");
  });

  it("keeps conversation history across turns", async () => {
    const { engine } = fakeEngine();
    const a = scripted([[say("An ETF holds many companies.")]]);
    const first = await runTurn(deps(a.generate, engine), { transcript: "What is an ETF?" });
    const b = scripted([[say("VOO is one example.")]]);
    await runTurn(deps(b.generate, engine), { transcript: "Give me an example", history: first.history });
    const sent = b.requests[0].contents.map((c) => JSON.stringify(c.parts));
    expect(sent[0]).toContain("What is an ETF?");
    expect(sent[1]).toContain("An ETF holds many companies.");
    expect(sent.at(-1)).toContain("Give me an example");
  });

  it("reports engine errors to the model instead of crashing", async () => {
    const { engine } = fakeEngine({ "/quote": new EngineError(0, "engine_unreachable", "The trading engine is not reachable") });
    const { generate, requests } = scripted([[call("get_quote", { symbol: "VOO" })], [say("I can't reach prices right now.")]]);
    const r = await runTurn(deps(generate, engine), { transcript: "VOO?" });
    expect(r.tools).toEqual(["get_quote!"]);
    expect(JSON.stringify(requests[1].contents.at(-1))).toMatch(/engine_unreachable/);
  });
});

describe("two-step trades through the tutor", () => {
  it("propose stores the pending order and asks the UI to confirm", async () => {
    const { engine } = fakeEngine();
    const { generate } = scripted([[call("propose_trade", { side: "buy", symbol: "VOO", quantity: 1 })], [say("Buy 1 share of VOO at $701.75. Say confirm.")]]);
    const r = await runTurn(deps(generate, engine), { transcript: "buy one share of VOO" });
    expect(r.state.pendingProposal).toEqual({ id: "p1" });
    expect(r.directives.find((d) => d.type === "confirm")).toBeDefined();
  });

  it("refuses confirm_trade when the learner didn't say confirm", async () => {
    const { engine, calls } = fakeEngine();
    const { generate } = scripted([[call("confirm_trade", { proposal_id: "p1" })], [say("Okay.")]]);
    const r = await runTurn(deps(generate, engine), { transcript: "what's the price again", state: { pendingProposal: { id: "p1" } } });
    expect(r.tools).toEqual(["confirm_trade!"]);
    expect(calls.some((c) => c.path === "/confirm")).toBe(false);
    expect(r.state.pendingProposal).toEqual({ id: "p1" });
  });

  it("confirms when the learner says confirm", async () => {
    const { engine, calls } = fakeEngine();
    const { generate } = scripted([[call("confirm_trade", { proposal_id: "p1" })], [say("Done. You bought 1 share of VOO at $701.75.")]]);
    const r = await runTurn(deps(generate, engine), { transcript: "yes, confirm", state: { pendingProposal: { id: "p1" } } });
    expect(calls.find((c) => c.path === "/confirm")?.body).toEqual({ id: "p1" });
    expect(r.state.pendingProposal).toBeNull();
    expect(r.directives.find((d) => d.type === "settled")).toBeDefined();
  });

  it("Enter confirms directly without the model", async () => {
    const { engine } = fakeEngine();
    const { generate, requests } = scripted([]);
    const r = await runAction(deps(generate, engine), { type: "confirm" }, { pendingProposal: { id: "p1" } });
    expect(requests).toHaveLength(0);
    expect(r.reply).toMatch(/^Done\. You bought 1 VOO with practice money/);
  });

  it("Enter with nothing pending explains instead of trading", async () => {
    const { engine, calls } = fakeEngine();
    const r = await runAction(deps(scripted([]).generate, engine), { type: "confirm" }, {});
    expect(r.reply).toMatch(/no order waiting/i);
    expect(calls).toHaveLength(0);
  });
});
