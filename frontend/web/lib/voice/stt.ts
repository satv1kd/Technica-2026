export interface SttResult {
  ok: boolean;
  text: string;
  confidence: number;
  message?: string;
}

const FAILED: SttResult = {
  ok: false, text: "", confidence: 0,
  message: "I didn't catch that. Try again, or type your question.",
};

export async function transcribe(blob: Blob, signal?: AbortSignal): Promise<SttResult> {
  const form = new FormData();
  const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  form.append("audio", blob, `speech.${extension}`);
  try {
    const response = await fetch("/api/stt", { method: "POST", body: form, signal });
    if (!response.ok) return FAILED;
    const result = await response.json();
    if (result.ok !== true || typeof result.text !== "string" || !result.text.trim() ||
        !Number.isFinite(result.confidence) || result.confidence < 0.6) return FAILED;
    return { ok: true, text: result.text.trim(), confidence: result.confidence };
  } catch {
    return FAILED;
  }
}
