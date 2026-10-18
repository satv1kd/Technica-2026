import { z } from "zod";

const nonEmpty = z.string().min(1);

/** Keys the app cannot run without. */
const requiredSchema = z.object({
  GEMINI_API_KEY: nonEmpty,
  ELEVENLABS_API_KEY: nonEmpty,
  DATABASE_URL: nonEmpty,
});

/** Keys that only unlock optional behavior; each has a documented fallback. */
const optionalSchema = z.object({
  ALPACA_KEY_ID: z.string().optional(),
  ALPACA_SECRET_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  SOLANA_RPC_URL: z.string().default("https://api.devnet.solana.com"),
  SOLANA_PAYER_SECRET_KEY: z.string().optional(),
  ENGINE_URL: z.string().default("http://localhost:8000"),
  CHAIN_URL: z.string().default("http://localhost:8001"),
});

export type Config = z.infer<typeof requiredSchema> & z.infer<typeof optionalSchema>;

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill them in.`,
    );
    this.name = "ConfigError";
  }
}

/**
 * Load and validate configuration. Fails fast with a clear message when a
 * required key is missing. Pass an env object for testing.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const required = requiredSchema.safeParse(env);
  if (!required.success) {
    throw new ConfigError(required.error.issues.map((i) => String(i.path[0])));
  }
  return { ...required.data, ...optionalSchema.parse(env) };
}
