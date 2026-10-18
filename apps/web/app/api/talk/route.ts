import { NextResponse } from "next/server";
import { GeminiError } from "../../../../../services/tutor/gemini";
import { runTurn } from "../../../../../services/tutor/loop";
import { tutor } from "../../../../../services/tutor/server";

export const runtime = "nodejs";

/** Free-form learner turn: transcript in, spoken reply and UI directives out. */
export async function POST(req: Request) {
  const { transcript, history, state } = await req.json();
  if (typeof transcript !== "string" || !transcript.trim()) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await runTurn(tutor().deps, { transcript: transcript.slice(0, 2000), history, state }));
  } catch (err) {
    const e = err as Error;
    console.warn(`[talk] ${e.message}`);
    const reply =
      e instanceof GeminiError
        ? "My thinking service isn't available right now. You can still use the menu: press M."
        : "Something went wrong on my side. Please try again.";
    return NextResponse.json({ reply, directives: [], state, history, tools: [], error: e.message }, { status: 200 });
  }
}
