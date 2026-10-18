import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keys live in one .env at the repo root, shared by every service.
// Next only reads .env from apps/web, and @next/env caches the first folder it
// loads, so load the root file with Node directly. Existing variables win.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootEnv = path.join(repoRoot, ".env");
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Browser tests get their own output so a running dev server cannot overwrite it.
  distDir: process.env.SONAR_NEXT_DIST_DIR || ".next",
  // Lets the app import shared code from ../../services.
  experimental: { externalDir: true },
  // Pin the workspace root so Next ignores lockfiles in parent folders.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
