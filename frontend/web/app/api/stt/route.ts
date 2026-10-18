import { NextResponse } from "next/server";
import { MIN_CONFIDENCE, transcribe } from "../../../../../backend/services/voice/stt";
import { tutor } from "../../../../../backend/services/tutor/server";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

/** Audio in, transcript out. The audio is forwarded to ElevenLabs and never saved. */
export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "audio is required" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: "audio too long" }, { status: 413 });
  try {
    const t = await transcribe(audio, tutor().elevenKey);
    if (!t.text || t.confidence < MIN_CONFIDENCE) {
      return NextResponse.json({ ...t, ok: false, message: "I didn't catch that, try again." });
    }
    return NextResponse.json({ ...t, ok: true });
  } catch (err) {
    console.warn(`[stt] ${(err as Error).message}`);
    return NextResponse.json({ ok: false, text: "", confidence: 0, message: "I didn't catch that, try again." });
  }
}
