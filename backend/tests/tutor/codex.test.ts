import { describe, expect, it } from "vitest";
import { codexClient, fromOutput, toInput, toTools } from "@services/tutor/codex";
import { LlmError, type Content } from "@services/tutor/llm";

describe("Codex message translation", () => {
  it("maps text, calls, and results to Responses API items, keeping call ids", () => {
    const contents: Content[] = [
      { role: "user", parts: [{ text: "How is Apple?" }] },
      { role: "model", parts: [{ functionCall: { id: "call_a", name: "get_quote", args: { symbol: "AAPL" } } }] },
      { role: "user", parts: [{ functionResponse: { id: "call_a", name: "get_quote", response: { result: { price: 343.39 } } } }] },
      { role: "model", parts: [{ text: "Apple closed at $343.39." }] },
    ];
    expect(toInput(contents)).toEqual([
      { role: "user", content: "How is Apple?" },
      { type: "function_call", call_id: "call_a", name: "get_quote", arguments: '{"symbol":"AAPL"}' },
      { type: "function_call_output", call_id: "call_a", output: '{"result":{"price":343.39}}' },
      { role: "assistant", content: "Apple closed at $343.39." },
    ]);
  });

  it("pairs results with calls by name when old history has no ids", () => {
    const items = toInput([
      { role: "model", parts: [
        { functionCall: { name: "get_quote", args: { symbol: "AAPL" } } },
        { functionCall: { name: "show_chart", args: {} } },
      ] },
      { role: "user", parts: [
        { functionResponse: { name: "show_chart", response: {} } },
        { functionResponse: { name: "get_quote", response: {} } },
      ] },
    ]) as any[];
    const callId = (name: string) => items.find((i) => i.type === "function_call" && i.name === name).call_id;
    expect(items[2].call_id).toBe(callId("show_chart"));
    expect(items[3].call_id).toBe(callId("get_quote"));
    expect(callId("get_quote")).not.toBe(callId("show_chart"));
  });

  it("gives parameterless tools an empty object schema", () => {
    expect(toTools([{ name: "list_markets", description: "List assets" }])).toEqual([
      { type: "function", name: "list_markets", description: "List assets", parameters: { type: "object", properties: {} }, strict: false },
    ]);
  });

  it("reads text and function calls from output, skipping reasoning", () => {
    expect(fromOutput([
      { type: "reasoning", summary: [] },
      { type: "function_call", call_id: "call_x", name: "get_quote", arguments: '{"symbol":"VOO"}' },
      { type: "message", content: [{ type: "output_text", text: "One moment." }] },
      { type: "function_call", call_id: "call_y", name: "list_markets", arguments: "not json" },
    ])).toEqual([
      { functionCall: { id: "call_x", name: "get_quote", args: { symbol: "VOO" } } },
      { text: "One moment." },
      { functionCall: { id: "call_y", name: "list_markets", args: {} } },
    ]);
  });
});

describe("codexClient", () => {
  it("posts a stateless Responses request with tools and reasoning effort", async () => {
    const sent: any[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "Hi." }] }] }));
    }) as unknown as typeof fetch;
    const generate = codexClient("sk-test", "gpt-5.3-codex", { effort: "low", fetchImpl });
    const r = await generate({
      system: "You are Sonar.",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [{ name: "list_markets", description: "List assets" }],
      toolChoice: "none",
    });

    expect(r.parts).toEqual([{ text: "Hi." }]);
    expect(sent[0].url).toBe("https://api.openai.com/v1/responses");
    expect((sent[0].headers as any).authorization).toBe("Bearer sk-test");
    expect(sent[0].body).toMatchObject({
      model: "gpt-5.3-codex", instructions: "You are Sonar.", store: false,
      reasoning: { effort: "low" }, tool_choice: "none",
      input: [{ role: "user", content: "hello" }],
    });
    expect(sent[0].body.tools).toHaveLength(1);
  });

  it("turns API errors into LlmError", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 })) as unknown as typeof fetch;
    const generate = codexClient("bad", "gpt-5.3-codex", { fetchImpl });
    await expect(generate({ system: "", contents: [] })).rejects.toThrow(LlmError);
  });
});
