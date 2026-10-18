import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesize, OPENAI_TTS_MODEL, OPENAI_VOICE, type TtsConfig } from "@services/voice/tts";
import { transcribe } from "@services/voice/stt";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(path.join(directory, file));
    rmdirSync(directory);
  }
});

function config(fetchImpl: typeof fetch): TtsConfig {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "sonar-voice-test-"));
  directories.push(cacheDir);
  return { elevenKey: "test", openaiKey: "test", voiceId: "voice", cacheDir, fetchImpl };
}

describe("speech providers", () => {
  it("streams ElevenLabs audio and reuses the completed clip from cache", async () => {
    const request = vi.fn().mockResolvedValue(new Response("mp3", { headers: { "content-type": "audio/mpeg" } }));
    const cfg = config(request);
    const result = await synthesize(cfg, "Hello");
    expect(result?.provider).toBe("elevenlabs");
    expect(await new Response(result?.body as BodyInit).text()).toBe("mp3");
    expect((await synthesize(cfg, "Hello"))?.provider).toBe("cache");
    expect(request).toHaveBeenCalledOnce();
  });

  it("falls back to OpenAI speech on ElevenLabs failure and caches the MP3", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(new Response("openai-mp3", { headers: { "content-type": "audio/mpeg" } }));
    const cfg = config(request);
    const result = await synthesize(cfg, "Hello", "slow", () => {});
    expect(result?.provider).toBe("openai");
    expect(result?.contentType).toBe("audio/mpeg");
    expect(Buffer.from(result?.body as Uint8Array).toString()).toBe("openai-mp3");

    const [url, init] = request.mock.calls[1];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.headers.authorization).toBe("Bearer test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: OPENAI_TTS_MODEL, voice: OPENAI_VOICE, input: "Hello", response_format: "mp3" });
    expect(body.instructions).toMatch(/warm, patient teacher.*Speak a little slower\./);

    // The fallback clip is cached, so a replay costs no API call.
    expect((await synthesize(cfg, "Hello", "slow", () => {}))?.provider).toBe("cache");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable when both providers fail so browser speech can take over", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Offline"));
    expect(await synthesize(config(request), "Hello", "normal", () => {})).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("derives STT confidence from word probabilities and rejects provider errors", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ text: " ETF ", words: [{ type: "word", logprob: Math.log(0.5) }] }));
    expect(await transcribe(new Blob(["speech"]), "test", request)).toEqual({ text: "ETF", confidence: 0.5 });
    request.mockResolvedValue(new Response("error", { status: 503 }));
    await expect(transcribe(new Blob(["speech"]), "test", request)).rejects.toThrow("ElevenLabs STT 503");
  });
});
