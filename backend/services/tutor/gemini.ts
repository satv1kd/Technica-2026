/**
 * Minimal Gemini REST client (v1beta generateContent with function calling).
 * Kept as plain fetch so tests can swap in recorded responses.
 */

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export type Part =
  | { text: string }
  | { functionCall: FunctionCall }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: object;
}

export interface GenerateRequest {
  system: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
}

export interface GenerateResponse {
  parts: Part[];
}

export type Generate = (req: GenerateRequest) => Promise<GenerateResponse>;

export class GeminiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Gemini ${status}: ${message}`);
    this.name = "GeminiError";
  }
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function geminiClient(apiKey: string, model: string, timeoutMs = 20_000): Generate {
  return async ({ system, contents, tools }) => {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        ...(tools?.length ? { tools: [{ functionDeclarations: tools }] } : {}),
        generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new GeminiError(res.status, body?.error?.message ?? res.statusText);
    const parts: Part[] = body?.candidates?.[0]?.content?.parts ?? [];
    return { parts };
  };
}

export function textOf(parts: Part[]): string {
  return parts
    .map((p) => ("text" in p ? p.text : ""))
    .join("")
    .trim();
}

export function callsOf(parts: Part[]): FunctionCall[] {
  return parts.flatMap((p) => ("functionCall" in p ? [p.functionCall] : []));
}
