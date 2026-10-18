import fs from "node:fs";
import path from "node:path";

let root: string | null = null;

/**
 * The repo root, found by walking up from this file and from the working
 * directory. Works under tsx, Vitest, and Next.js (whose bundles move
 * __dirname, and which runs with cwd = apps/web).
 */
export function repoRoot(): string {
  if (root) return root;
  const starts = [typeof __dirname === "string" ? __dirname : "", process.cwd()].filter(Boolean);
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(dir, "services", "lessons", "content"))) return (root = dir);
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("Could not find the Sonar repo root.");
}

export const repoPath = (...parts: string[]) => path.join(repoRoot(), ...parts);
