import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesize, STYLE_PROMPT, type TtsConfig } from "@services/voice/tts";
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
  return { elevenKey: "test", geminiKey: "test", voiceId: "voice", geminiModels: ["test-tts"], cacheDir, fetchImpl };
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

  it("falls back to Gemini on ElevenLabs failure and wraps PCM as WAV", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([0, 1, 2, 3]).toString("base64") } }] } }] }));
    const result = await synthesize(config(request), "Hello", "slow", () => {});
    expect(result?.provider).toBe("gemini");
    expect(result?.contentType).toBe("audio/wav");
    const bytes = Buffer.from(await new Response(result?.body as BodyInit).arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.length).toBe(48);
    expect(JSON.parse(request.mock.calls[1][1].body).contents[0].parts[0].text).toContain(STYLE_PROMPT);
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
