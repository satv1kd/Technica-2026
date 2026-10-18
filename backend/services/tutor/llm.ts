/**
 * The model interface the tutor loop talks to. Messages are a list of
 * user/model turns made of text, function calls, and function results, which
 * is also the history the browser sends back each turn. A client (codex.ts)
 * translates this to a provider's API, so tests can swap in scripted replies.
 */

export interface FunctionCall {
  /** Provider's call id; links a result back to its call. */
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export type Part =
  | { text: string }
  | { functionCall: FunctionCall }
  | { functionResponse: { id?: string; name: string; response: Record<string, unknown> } };

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
  /** "none" asks for words only, while still letting the history hold earlier calls. */
  toolChoice?: "auto" | "none";
}

export interface GenerateResponse {
  parts: Part[];
}

export type Generate = (req: GenerateRequest) => Promise<GenerateResponse>;

export class LlmError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Model ${status}: ${message}`);
    this.name = "LlmError";
  }
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
