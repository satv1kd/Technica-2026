import { NextResponse } from "next/server";
import { EngineError, qs } from "../../../../../backend/services/tutor/engine";
import { tutor } from "../../../../../backend/services/tutor/server";

export const runtime = "nodejs";

const RANGES = new Set(["1w", "1m", "3m", "6m", "1y", "2y"]);

/**
 * Read-only market data for the trade results panel (never spoken, so it
 * doesn't go through the tutor). GET ?kind=history&symbol=VOO&range=1m, or
 * ?kind=portfolio.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const { engine } = tutor().deps;
  try {
    if (kind === "portfolio") return NextResponse.json(await engine("/portfolio"));
    if (kind === "history") {
      const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
      const range = url.searchParams.get("range") ?? "1m";
      if (!/^[A-Z]{1,6}$/.test(symbol) || !RANGES.has(range)) {
        return NextResponse.json({ error: "bad_request" }, { status: 400 });
      }
      return NextResponse.json(await engine(`/history${qs({ symbol, range })}`));
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (err) {
    const status = err instanceof EngineError && err.status >= 400 ? err.status : 503;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
