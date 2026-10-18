import { synthesize, type Speed } from "../../../../../services/voice/tts";
import { tutor } from "../../../../../services/tutor/server";

export const runtime = "nodejs";

const SPEEDS = new Set(["slow", "normal", "fast"]);

/** Text in, audio out (streamed when live). 503 tells the browser to use speechSynthesis. */
export async function POST(req: Request) {
  const { text, speed = "normal" } = await req.json();
  if (typeof text !== "string" || !text.trim() || text.length > 2500) {
    return Response.json({ error: "text is required (max 2500 characters)" }, { status: 400 });
  }
  const result = await synthesize(tutor().tts, text.trim(), SPEEDS.has(speed) ? (speed as Speed) : "normal");
  if (!result) return Response.json({ error: "tts_unavailable" }, { status: 503 });
  return new Response(result.body as BodyInit, {
    headers: {
      "content-type": result.contentType,
      "x-tts-provider": result.provider,
      "cache-control": "no-store",
    },
  });
}
