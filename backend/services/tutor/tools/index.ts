import type { FunctionDeclaration } from "../llm";
import { TRADING_TOOLS } from "./trading";
import { tutoringTools } from "./tutoring";
import type { Tool } from "./types";

export * from "./types";

/** Tools the UI can trigger directly but the model never sees. */
export const INTERNAL_TOOLS = new Set(["confirm_lesson_trade"]);

export function buildRegistry(): Map<string, Tool> {
  const registry = new Map<string, Tool>();
  for (const t of TRADING_TOOLS) registry.set(t.name, t);
  for (const t of tutoringTools(registry)) registry.set(t.name, t);
  return registry;
}

export function declarations(registry: Map<string, Tool>): FunctionDeclaration[] {
  return [...registry.values()]
    .filter((t) => !INTERNAL_TOOLS.has(t.name))
    .map(({ name, description, parameters }) => ({
      name,
      description,
      ...(Object.keys(parameters.properties).length ? { parameters } : {}),
    }));
}
