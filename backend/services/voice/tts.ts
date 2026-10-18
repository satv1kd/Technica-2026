/**
 * Text to speech, server side.
 *
 * ElevenLabs streaming is primary; Gemini TTS is the fallback; if both fail
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
  provider: "elevenlabs" | "gemini" | "cache";
  contentType: string;
  /** Stream for live ElevenLabs audio, bytes otherwise. */
  body: ReadableStream<Uint8Array> | Uint8Array;
}

export interface TtsConfig {
  elevenKey?: string;
  voiceId: string;
  geminiKey?: string;
  geminiModels: string[];
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

/** Wrap 16-bit little-endian mono PCM (Gemini's output) in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24_000): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
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

async function gemini(cfg: TtsConfig, text: string, speed: Speed, file: string): Promise<TtsResult> {
  const f = cfg.fetchImpl ?? fetch;
  const pace = speed === "slow" ? " Speak a little slower." : speed === "fast" ? " Speak a little faster." : "";
  let last = "no Gemini TTS model configured";
  for (const model of cfg.geminiModels) {
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": cfg.geminiKey!, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${STYLE_PROMPT}${pace} ${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    const data = body?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (res.ok && data) {
      const wav = pcmToWav(Buffer.from(data, "base64"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, wav);
      return { provider: "gemini", contentType: "audio/wav", body: wav };
    }
    last = `${model} ${res.status}: ${body?.error?.message ?? "no audio"}`;
    if (res.status !== 404) break; // only a missing model is worth trying the next name
  }
  throw new Error(`Gemini TTS failed: ${last}`);
}

export async function synthesize(
  cfg: TtsConfig,
  text: string,
  speed: Speed = "normal",
  log: (m: string) => void = console.warn,
): Promise<TtsResult | null> {
  const dir = cfg.cacheDir ?? repoPath("data", "tts-cache");
  const elevenKey = cacheKey("elevenlabs", cfg.voiceId, speed, text);
  const geminiKey = cacheKey("gemini", "Sulafat", speed, text);
  const cached = readCache(dir, [elevenKey, geminiKey]);
  if (cached) return cached;

  if (cfg.elevenKey) {
    try {
      return await elevenlabs(cfg, text, speed, cachePaths(dir, elevenKey).mp3);
    } catch (err) {
      log(`[tts] ElevenLabs failed, trying Gemini: ${(err as Error).message}`);
    }
  }
  if (cfg.geminiKey) {
    try {
      return await gemini(cfg, text, speed, cachePaths(dir, geminiKey).wav);
    } catch (err) {
      log(`[tts] ${(err as Error).message}`);
    }
  }
  return null;
}
