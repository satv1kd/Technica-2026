import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@services": path.resolve(__dirname, "services"),
      "@web": path.resolve(__dirname, "apps/web"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Devnet tests spend real (free) devnet SOL; run them only when asked for by name.
    exclude: process.argv.some((a) => a.includes("devnet"))
      ? ["node_modules/**"]
      : ["tests/**/*.devnet.test.ts", "node_modules/**"],
    environment: "node",
  },
});
