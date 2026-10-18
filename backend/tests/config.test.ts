import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "@services/config";
import { register } from "@web/instrumentation";

const full = { CODEX_API_KEY: "g", ELEVENLABS_API_KEY: "e", DATABASE_URL: "postgres://u:p@host/db" };

function catchConfigError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error("expected a ConfigError");
}

describe("loadConfig", () => {
  it("loads required keys and applies defaults", () => {
    const cfg = loadConfig(full);
    expect(cfg.CODEX_API_KEY).toBe("g");
    expect(cfg.SOLANA_RPC_URL).toContain("devnet");
    expect(cfg.ENGINE_URL).toBe("http://localhost:8000");
  });

  it("fails fast naming every missing key", () => {
    const err = catchConfigError(() => loadConfig({ CODEX_API_KEY: "g" }));
    expect(err.missing).toEqual(["ELEVENLABS_API_KEY", "DATABASE_URL"]);
    expect(err.message).toContain("ELEVENLABS_API_KEY is missing");
    expect(err.message).toContain(".env.example");
  });

  it("treats empty and whitespace-only values as missing", () => {
    const err = catchConfigError(() => loadConfig({ ...full, CODEX_API_KEY: "  " }));
    expect(err.missing).toEqual(["CODEX_API_KEY"]);
  });

  it("treats template placeholders as missing", () => {
    const err = catchConfigError(() =>
      loadConfig({ ...full, CODEX_API_KEY: "your_openai_api_key_here" }),
    );
    expect(err.missing).toEqual(["CODEX_API_KEY"]);
  });

  it("reports a malformed DATABASE_URL as invalid, not missing", () => {
    const err = catchConfigError(() => loadConfig({ ...full, DATABASE_URL: "mysql://x" }));
    expect(err.missing).toEqual([]);
    expect(err.invalid[0].key).toBe("DATABASE_URL");
    expect(err.message).toContain("postgres://");
  });

  it("lets blank optional keys fall back to defaults", () => {
    const cfg = loadConfig({ ...full, SOLANA_RPC_URL: "", CODEX_MODEL: "" });
    expect(cfg.SOLANA_RPC_URL).toBe("https://api.devnet.solana.com");
    expect(cfg.CODEX_MODEL).toBe("gpt-5.3-codex");
    expect(cfg.CODEX_REASONING).toBe("low");
  });

  it("accepts OPENAI_API_KEY as the Codex key", () => {
    const { CODEX_API_KEY: _, ...rest } = full;
    expect(loadConfig({ ...rest, OPENAI_API_KEY: "sk-o" }).CODEX_API_KEY).toBe("sk-o");
  });

  it("rejects a malformed optional URL", () => {
    const err = catchConfigError(() => loadConfig({ ...full, ENGINE_URL: "not a url" }));
    expect(err.invalid.map((i) => i.key)).toEqual(["ENGINE_URL"]);
  });
});

describe("server startup", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses to start without keys", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("CODEX_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    await expect(register()).rejects.toThrow(/CODEX_API_KEY is missing/);
  });

  it("skips validation on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await expect(register()).resolves.toBeUndefined();
  });
});
