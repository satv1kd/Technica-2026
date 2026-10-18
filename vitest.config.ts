import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@services": path.resolve(__dirname, "backend/services"),
      "@web": path.resolve(__dirname, "frontend/web"),
    },
  },
  test: {
    include: ["backend/tests/**/*.test.ts", "frontend/tests/unit/**/*.test.ts"],
    // Devnet tests spend real (free) devnet SOL and live tests call paid APIs;
    // run them only when asked for by name.
    exclude: [
      "node_modules/**",
      ...(process.argv.some((a) => a.includes("devnet")) ? [] : ["**/*.devnet.test.ts"]),
      ...(process.argv.some((a) => a.includes("live")) ? [] : ["**/*.live.test.ts"]),
    ],
    environment: "node",
  },
});
