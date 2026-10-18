/**
 * OpenAI Codex client: the OpenAI Responses API with function calling.
 * Codex models are served only by the Responses API, not Chat Completions.
 * Plain fetch, stateless (store: false): the whole conversation is sent
 * each turn, translated from the tutor's message format in llm.ts.
 */
import { LlmError, type Content, type FunctionDeclaration, type Generate, type Part } from "./llm";

const URL = "https://api.openai.com/v1/responses";

export type Effort = "minimal" | "low" | "medium" | "high";

/** Tutor messages -> Responses API input items. */
export function toInput(contents: Content[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  // History from older clients may lack call ids; pair results with calls in order.
  const unanswered: { id: string; name: string }[] = [];
  let n = 0;
  for (const c of contents) {
    for (const p of c.parts) {
      if ("text" in p) {
        if (p.text) items.push({ role: c.role === "model" ? "assistant" : "user", content: p.text });
      } else if ("functionCall" in p) {
        const id = p.functionCall.id ?? `call_${n++}`;
        unanswered.push({ id, name: p.functionCall.name });
        items.push({ type: "function_call", call_id: id, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) });
      } else {
        const r = p.functionResponse;
        const i = r.id ? unanswered.findIndex((u) => u.id === r.id) : unanswered.findIndex((u) => u.name === r.name);
        const id = r.id ?? (i >= 0 ? unanswered[i].id : `call_${n++}`);
        if (i >= 0) unanswered.splice(i, 1);
        items.push({ type: "function_call_output", call_id: id, output: JSON.stringify(r.response) });
      }
    }
  }
  return items;
}

export function toTools(decls: FunctionDeclaration[]) {
  return decls.map((d) => ({
    type: "function",
    name: d.name,
    description: d.description,
    parameters: d.parameters ?? { type: "object", properties: {} },
    strict: false,
  }));
}

/** Responses API output items -> tutor parts. Reasoning items are dropped. */
export function fromOutput(output: any[]): Part[] {
  const parts: Part[] = [];
  for (const item of output ?? []) {
    if (item.type === "message") {
      const text = (item.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
      if (text) parts.push({ text });
    } else if (item.type === "function_call") {
      let args: Record<string, unknown> = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        args = {};
      }
      parts.push({ functionCall: { id: item.call_id, name: item.name, args } });
    }
  }
  return parts;
}

export function codexClient(
  apiKey: string,
  model: string,
  opts: { effort?: Effort; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Generate {
  const f = opts.fetchImpl ?? fetch;
  return async ({ system, contents, tools, toolChoice }) => {
    const res = await f(URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      body: JSON.stringify({
        model,
        instructions: system,
        input: toInput(contents),
        ...(tools?.length ? { tools: toTools(tools), tool_choice: toolChoice ?? "auto" } : {}),
        reasoning: { effort: opts.effort ?? "low" },
        // Reasoning tokens count here too, so leave room for them.
        max_output_tokens: 4000,
        store: false,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new LlmError(res.status, body?.error?.message ?? res.statusText);
    return { parts: fromOutput(body.output) };
  };
}
