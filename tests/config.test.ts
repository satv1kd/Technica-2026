import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@services/config";

const full = { GEMINI_API_KEY: "g", ELEVENLABS_API_KEY: "e", DATABASE_URL: "postgres://x" };

describe("loadConfig", () => {
  it("loads required keys and applies defaults", () => {
    const cfg = loadConfig(full);
    expect(cfg.GEMINI_API_KEY).toBe("g");
    expect(cfg.SOLANA_RPC_URL).toContain("devnet");
  });

  it("fails fast naming every missing key", () => {
    try {
      loadConfig({ GEMINI_API_KEY: "g" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).missing).toEqual(["ELEVENLABS_API_KEY", "DATABASE_URL"]);
    }
  });

  it("treats empty strings as missing", () => {
    expect(() => loadConfig({ ...full, GEMINI_API_KEY: "" })).toThrow(ConfigError);
  });
});
