import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run dev -w apps/web -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
