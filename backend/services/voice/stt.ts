/** Speech to text with ElevenLabs Scribe. Audio is never stored. */

export const MIN_CONFIDENCE = 0.6;

export interface Transcript {
  text: string;
  confidence: number;
}

export class SttError extends Error {}

export async function transcribe(
  audio: Blob,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Transcript> {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("language_code", "en");
  form.append("tag_audio_events", "false");
  form.append("file", audio, "speech.webm");

  const res = await fetchImpl("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(12_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SttError(`ElevenLabs STT ${res.status}: ${body?.detail?.message ?? body?.detail ?? res.statusText}`);

  const text = String(body.text ?? "").trim();
  const words: { type?: string; logprob?: number }[] = (body.words ?? []).filter((w: any) => w.type === "word");
  // Mean word probability when available; otherwise the language confidence.
  const probs = words.map((w) => w.logprob).filter((l): l is number => typeof l === "number").map(Math.exp);
  const confidence = !text
    ? 0
    : probs.length
      ? probs.reduce((a, b) => a + b, 0) / probs.length
      : Number(body.language_probability ?? 1);
  return { text, confidence: Number(confidence.toFixed(3)) };
}
