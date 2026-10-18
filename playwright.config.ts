import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "frontend/tests/e2e",
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    // A production build: no on-demand compiling while tests run, so cold
    // starts can't time out parallel workers. Set E2E_DEV=1 to test the dev server.
    command: process.env.E2E_DEV
      ? `npm run dev -w frontend/web -- --port ${PORT}`
      : `npm run build -w frontend/web && npm run start -w frontend/web -- --port ${PORT}`,
    env: { SONAR_NEXT_DIST_DIR: ".next-e2e" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
