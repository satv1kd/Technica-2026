/** REST client for the Python trading engine (services/engine). */

export class EngineError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export type EngineFetch = (path: string, init?: { method?: string; body?: unknown }) => Promise<any>;

export function engineClient(baseUrl: string, timeoutMs = 12_000): EngineFetch {
  return async (path, init = {}) => {
    let res: Response;
    try {
      res = await fetch(baseUrl.replace(/\/$/, "") + path, {
        method: init.method ?? "GET",
        headers: init.body ? { "content-type": "application/json" } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new EngineError(0, "engine_unreachable", `The trading engine is not reachable: ${(err as Error).message}`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new EngineError(res.status, body.error ?? "engine_error", body.message ?? res.statusText);
    return body;
  };
}

export function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  return entries.length ? "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : "";
}
