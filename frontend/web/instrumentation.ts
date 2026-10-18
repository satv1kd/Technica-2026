/**
 * Runs once when the Next.js server starts (dev and production).
 * Validating config here makes the app fail fast instead of erroring on the
 * first request that needs a key.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadConfig } = await import("../../backend/services/config");
  loadConfig();
}
