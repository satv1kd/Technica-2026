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
    environment: "node",
  },
});
