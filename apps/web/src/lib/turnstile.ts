/**
 * Cloudflare Turnstile server-side token verification.
 *
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * A missing or disabled Turnstile secret causes the check to short-circuit as `pass`
 * so local development works without credentials. In production, if `TURNSTILE_SECRET_KEY`
 * is present and the token is absent or invalid the request is rejected.
 */

export type TurnstileOutcome =
  | { ok: true }
  | { ok: false; code: "missing_token" | "invalid_token" | "fetch_error" | "timeout" };

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  challenge_ts?: string;
}

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

/**
 * Verifies a Turnstile challenge token against Cloudflare's API.
 *
 * Pass `remoteip` when `TRUST_PROXY` is enabled and the real client IP is known;
 * Cloudflare uses it as an additional signal.
 */
export async function verifyTurnstileToken(opts: {
  token: string | null | undefined;
  secretKey: string | undefined;
  remoteIp?: string | null;
}): Promise<TurnstileOutcome> {
  // No secret configured → dev mode, skip verification.
  if (!opts.secretKey) return { ok: true };

  if (!opts.token) return { ok: false, code: "missing_token" };

  const body = new URLSearchParams({ secret: opts.secretKey, response: opts.token });
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: controller.signal,
      cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    if (!res.ok) return { ok: false, code: "fetch_error" };

    const json = (await res.json()) as TurnstileResponse;
    return json.success ? { ok: true } : { ok: false, code: "invalid_token" };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return { ok: false, code: isAbort ? "timeout" : "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}
