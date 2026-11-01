import { z } from "zod";
import { EnvValidationError, PublicEnvViolationError } from "./errors.js";

export type EnvSource = Record<string, string | undefined>;

/**
 * Public variables are compiled into the browser bundle. Anything not on this list is
 * treated as a secret leak attempt, including NEXT_PUBLIC_LIVEKIT_API_SECRET.
 */
export const PUBLIC_ENV_ALLOWLIST: readonly string[] = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_LIVEKIT_URL",
  "NEXT_PUBLIC_REALTIME_WS_URL",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_COMMIT_SHA",
];

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Parses and validates an environment. Throws before the process can serve traffic.
 * Values are never included in the error text.
 *
 * Empty strings are treated as absent (undefined) so `.env.local` files with blank
 * entries like `GOOGLE_CLIENT_ID=` don't fail optional field validation.
 */
export function loadEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  app: string,
  source: EnvSource = process.env,
): z.infer<TSchema> {
  // Normalise: convert "" to undefined so optional fields behave correctly.
  const normalised: EnvSource = {};
  for (const [key, value] of Object.entries(source)) {
    normalised[key] = value === "" ? undefined : value;
  }
  const parsed = schema.safeParse(normalised);
  if (!parsed.success) {
    throw new EnvValidationError(app, formatIssues(parsed.error));
  }
  return parsed.data;
}

/**
 * Fails if the environment contains NEXT_PUBLIC_ variables that have not been reviewed,
 * because those values are embedded in the client bundle.
 */
export function assertNoUnexpectedPublicEnv(source: EnvSource): void {
  const unexpected = Object.keys(source).filter(
    (key) => key.startsWith("NEXT_PUBLIC_") && !PUBLIC_ENV_ALLOWLIST.includes(key),
  );
  if (unexpected.length > 0) {
    throw new PublicEnvViolationError(unexpected);
  }
}
