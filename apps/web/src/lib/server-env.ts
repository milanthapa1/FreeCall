import { loadWebEnv, type WebEnv } from "@freecall/config";

/**
 * The web environment is validated once per process and then frozen. Next.js may import
 * this module from several route handlers and from instrumentation, so the cache is
 * module-scoped rather than per-request.
 *
 * It is deliberately lazy: `next build` runs without runtime secrets, and the build must
 * not fail just because production configuration is absent. The first server process that
 * needs configuration fails loudly with variable names (never values).
 */
let cached: WebEnv | null = null;

export function getWebEnv(): WebEnv {
  if (cached !== null) return cached;
  cached = loadWebEnv();
  return cached;
}

export type WebEnvResult =
  | { ok: true; env: WebEnv }
  | { ok: false; errorName: string; message: string };

/**
 * Non-throwing variant for health reporting. Environment validation errors list variable
 * names and reasons only, so the message is safe to return to an internal caller.
 */
export function readWebEnv(): WebEnvResult {
  if (cached !== null) return { ok: true, env: cached };

  try {
    cached = loadWebEnv();
    return { ok: true, env: cached };
  } catch (error) {
    return {
      ok: false,
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "environment validation failed",
    };
  }
}

/** Test seam. Not used by application code. */
export function resetWebEnvForTests(): void {
  cached = null;
}
