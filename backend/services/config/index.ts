import { z } from "zod";

/** Values copied straight from .env.example templates count as missing. */
const PLACEHOLDER = /^(your[_-].*|.*_here|changeme|todo|xxx+)$/i;

const secret = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !PLACEHOLDER.test(v), "still a placeholder value");

/** Keys the app cannot run without. */
const requiredSchema = z.object({
  GEMINI_API_KEY: secret,
  ELEVENLABS_API_KEY: secret,
  DATABASE_URL: secret.refine(
    (v) => /^postgres(ql)?:\/\//.test(v),
    "must be a postgres:// or postgresql:// connection string",
  ),
});

/** Keys that only unlock optional behavior; each has a documented fallback. */
const optionalSchema = z.object({
  DATABASE_PASSWORD: z.string().optional(),
  ALPACA_KEY_ID: z.string().optional(),
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_SECRET_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().min(1).default("EXAVITQu4vr4xnSDxMaL"),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  SOLANA_PAYER_SECRET_KEY: z.string().optional(),
  ENGINE_URL: z.string().url().default("http://localhost:8000"),
  CHAIN_URL: z.string().url().default("http://localhost:8001"),
});

export type Config = z.infer<typeof requiredSchema> & z.infer<typeof optionalSchema>;

export class ConfigError extends Error {
  constructor(
    /** Required keys that are absent, empty, or placeholders. */
    public readonly missing: string[],
    /** Keys that are present but malformed, with the reason. */
    public readonly invalid: { key: string; reason: string }[] = [],
  ) {
    const lines = [
      ...missing.map((k) => `  - ${k} is missing`),
      ...invalid.map((i) => `  - ${i.key} ${i.reason}`),
    ];
    super(
      `Sonar configuration error:\n${lines.join("\n")}\n` +
        `Copy .env.example to .env at the repo root and fill these in.`,
    );
    this.name = "ConfigError";
  }
}

/** Optional keys that are blank in .env should fall back to their defaults. */
function dropBlanks(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
}

/**
 * Load and validate configuration. Fails fast with a clear message naming
 * every missing or malformed key. Pass an env object for testing.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const clean = dropBlanks(env);
  const missing: string[] = [];
  const invalid: { key: string; reason: string }[] = [];

  const required = requiredSchema.safeParse(clean);
  const optional = optionalSchema.safeParse(clean);

  for (const issue of [
    ...(required.success ? [] : required.error.issues),
    ...(optional.success ? [] : optional.error.issues),
  ]) {
    const key = String(issue.path[0]);
    const absent = clean[key] === undefined || issue.message === "still a placeholder value";
    if (absent) missing.push(key);
    else invalid.push({ key, reason: issue.message });
  }

  if (missing.length || invalid.length) throw new ConfigError(missing, invalid);
  return { ...required.data!, ...optional.data! };
}
