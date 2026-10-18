/** Process-wide tutor dependencies for the Next.js API routes. */
import { loadConfig } from "../config";
import { newPool } from "../data/db";
import { loadCurriculum } from "../lessons/loader";
import { DbProgress, demoAccount, MemoryProgress, type ProgressStore } from "../lessons/progress";
import type { TtsConfig } from "../voice/tts";
import { engineClient } from "./engine";
import { geminiClient } from "./gemini";
import type { TutorDeps } from "./loop";
import { buildRegistry } from "./tools";

const g = globalThis as unknown as { __sonar?: { deps: TutorDeps; tts: TtsConfig; elevenKey: string } };

export function tutor() {
  if (g.__sonar) return g.__sonar;
  const cfg = loadConfig();
  let progress: ProgressStore;
  try {
    const pool = newPool(cfg.DATABASE_URL, 3);
    progress = new DbProgress(pool, demoAccount(pool));
  } catch (err) {
    console.warn(`[tutor] progress falls back to memory: ${(err as Error).message}`);
    progress = new MemoryProgress();
  }
  const deps: TutorDeps = {
    generate: geminiClient(cfg.GEMINI_API_KEY, cfg.GEMINI_MODEL),
    engine: engineClient(cfg.ENGINE_URL),
    lessons: loadCurriculum(),
    progress,
    registry: buildRegistry(),
    log: (m) => console.warn(m),
  };
  const tts: TtsConfig = {
    elevenKey: cfg.ELEVENLABS_API_KEY,
    voiceId: cfg.ELEVENLABS_VOICE_ID,
    geminiKey: cfg.GEMINI_API_KEY,
    geminiModels: [process.env.GEMINI_TTS_MODEL, "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"].filter(
      (m): m is string => Boolean(m),
    ),
  };
  g.__sonar = { deps, tts, elevenKey: cfg.ELEVENLABS_API_KEY };
  return g.__sonar;
}
