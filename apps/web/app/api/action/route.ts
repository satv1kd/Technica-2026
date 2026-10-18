import { NextResponse } from "next/server";
import { runAction, type UiAction } from "../../../../../services/tutor/loop";
import { tutor } from "../../../../../services/tutor/server";

export const runtime = "nodejs";

const ALLOWED = new Set(["confirm", "cancel", "next", "prev", "repeat_step", "start_lesson", "quiz_answer", "tool"]);
/** Tools the UI may call directly (read-only or two-step-safe). */
const UI_TOOLS = new Set([
  "get_portfolio", "check_token_backing", "propose_trade", "cancel_trade", "show_chart",
  "get_quote", "run_backtest", "review_trades", "explain_fees",
]);

/** Deterministic UI actions (Enter, N/P, quiz keys, menu picks). No model call. */
export async function POST(req: Request) {
  const { action, state } = (await req.json()) as { action: UiAction; state?: any };
  if (!action || !ALLOWED.has(action.type) || (action.type === "tool" && !UI_TOOLS.has(action.name))) {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }
  try {
    return NextResponse.json(await runAction(tutor().deps, action, state ?? {}));
  } catch (err) {
    console.warn(`[action] ${(err as Error).message}`);
    return NextResponse.json({ reply: "Something went wrong on my side. Please try again.", directives: [], state }, { status: 200 });
  }
}
