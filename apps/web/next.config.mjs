import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

// Keys live in one .env at the repo root, shared by every service.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(repoRoot);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the app import shared code from ../../services.
  experimental: { externalDir: true },
  // Pin the workspace root so Next ignores lockfiles in parent folders.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
