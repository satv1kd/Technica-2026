/**
 * Text to speech, server side.
 *
 * ElevenLabs streaming is primary; OpenAI TTS is the fallback; if both fail
 * the route answers 503 and the browser uses speechSynthesis.
 *
 * Every clip is cached on disk by (provider, voice, speed, text). The free
 * ElevenLabs tier allows 10,000 characters a month, and menus and lesson
 * steps repeat a lot, so the cache keeps most replays free.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repoPath } from "../paths";

export type Speed = "slow" | "normal" | "fast";
export const SPEEDS: Record<Speed, number> = { slow: 0.85, normal: 1.0, fast: 1.15 };

export interface TtsResult {
  provider: "elevenlabs" | "openai" | "cache";
  contentType: string;
  /** Stream for live ElevenLabs audio, bytes otherwise. */
  body: ReadableStream<Uint8Array> | Uint8Array;
}

export interface TtsConfig {
  elevenKey?: string;
  voiceId: string;
  openaiKey?: string;
  openaiModel?: string;
  openaiVoice?: string;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}

export const STYLE_PROMPT = "Say this as a warm, patient teacher, slightly slow:";

export function cacheKey(provider: string, voice: string, speed: Speed, text: string): string {
  return crypto.createHash("sha256").update(`${provider}|${voice}|${speed}|${text}`).digest("hex").slice(0, 32);
}

function cachePaths(dir: string, key: string) {
  return { mp3: path.join(dir, `${key}.mp3`), wav: path.join(dir, `${key}.wav`) };
}

function readCache(dir: string, keys: string[]): TtsResult | null {
  for (const key of keys) {
    const { mp3, wav } = cachePaths(dir, key);
    if (fs.existsSync(mp3)) return { provider: "cache", contentType: "audio/mpeg", body: fs.readFileSync(mp3) };
    if (fs.existsSync(wav)) return { provider: "cache", contentType: "audio/wav", body: fs.readFileSync(wav) };
  }
  return null;
}

/** Pass a stream through while saving it to the cache once it completes. */
function teeToFile(stream: ReadableStream<Uint8Array>, file: string): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        chunks.push(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.concat(chunks));
      },
    }),
  );
}

async function elevenlabs(cfg: TtsConfig, text: string, speed: Speed, file: string): Promise<TtsResult> {
  const f = cfg.fetchImpl ?? fetch;
  const res = await f(
    `https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}/stream?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": cfg.elevenKey!, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.6, similarity_boost: 0.75, speed: SPEEDS[speed] },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok || !res.body) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { provider: "elevenlabs", contentType: "audio/mpeg", body: teeToFile(res.body, file) };
}

export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
export const OPENAI_VOICE = "sage";

async function openai(cfg: TtsConfig, text: string, speed: Speed, file: string): Promise<TtsResult> {
  const f = cfg.fetchImpl ?? fetch;
  const pace = speed === "slow" ? " Speak a little slower." : speed === "fast" ? " Speak a little faster." : "";
  const res = await f("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.openaiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.openaiModel ?? OPENAI_TTS_MODEL,
      voice: cfg.openaiVoice ?? OPENAI_VOICE,
      input: text,
      instructions: `${STYLE_PROMPT.replace(/:$/, ".")}${pace}`,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const mp3 = new Uint8Array(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, mp3);
  return { provider: "openai", contentType: "audio/mpeg", body: mp3 };
}

export async function synthesize(
  cfg: TtsConfig,
  text: string,
  speed: Speed = "normal",
  log: (m: string) => void = console.warn,
): Promise<TtsResult | null> {
  const dir = cfg.cacheDir ?? repoPath("data", "tts-cache");
  const elevenKey = cacheKey("elevenlabs", cfg.voiceId, speed, text);
  const openaiKey = cacheKey("openai", cfg.openaiVoice ?? OPENAI_VOICE, speed, text);
  const cached = readCache(dir, [elevenKey, openaiKey]);
  if (cached) return cached;

  if (cfg.elevenKey) {
    try {
      return await elevenlabs(cfg, text, speed, cachePaths(dir, elevenKey).mp3);
    } catch (err) {
      log(`[tts] ElevenLabs failed, trying OpenAI: ${(err as Error).message}`);
    }
  }
  if (cfg.openaiKey) {
    try {
      return await openai(cfg, text, speed, cachePaths(dir, openaiKey).mp3);
    } catch (err) {
      log(`[tts] ${(err as Error).message}`);
    }
  }
  return null;
}
