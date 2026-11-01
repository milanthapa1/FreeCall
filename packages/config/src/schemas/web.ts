import { z } from "zod";
import {
  booleanDefault,
  nodeEnv,
  postgresUrl,
  positiveInt,
  redisUrl,
  requireTogether,
  secret,
  url,
} from "../primitives.js";
import { assertNoUnexpectedPublicEnv, loadEnv, type EnvSource } from "../load.js";

const r2Keys = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_EVIDENCE_BUCKET",
] as const;

const ageProviderKeys = ["AGE_PROVIDER_API_KEY", "AGE_PROVIDER_WEBHOOK_SECRET"] as const;

export const webEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    BETTER_AUTH_SECRET: secret(32),
    BETTER_AUTH_URL: url,
    NEXT_PUBLIC_APP_URL: url,

    LIVEKIT_API_URL: url,
    LIVEKIT_API_KEY: z.string().min(8),
    LIVEKIT_API_SECRET: secret(32),
    NEXT_PUBLIC_LIVEKIT_URL: url.optional(),

    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: secret(16).optional(),
    R2_EVIDENCE_BUCKET: z.string().min(3).optional(),
    /** S3-compatible endpoint override (MinIO locally; derived from the account id otherwise). */
    R2_ENDPOINT: url.optional(),
    R2_FORCE_PATH_STYLE: booleanDefault(false),

    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: secret(16).optional(),

    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),

    STRIPE_SECRET_KEY: z
      .string()
      .regex(/^sk_(test|live)_/, "must be a Stripe secret key")
      .optional(),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .regex(/^whsec_/, "must be a Stripe webhook signing secret")
      .optional(),

    AGE_ASSURANCE_PROVIDER: z.enum(["yoti", "persona", "veriff"]).optional(),
    AGE_PROVIDER_API_KEY: z.string().min(1).optional(),
    AGE_PROVIDER_WEBHOOK_SECRET: secret(16).optional(),

    /** Google OAuth 2.0 */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    MODERATION_ENABLED: booleanDefault(true),
    GUEST_MAX_MINUTES_PER_DAY: positiveInt.default(30),

    SENTRY_DSN: url.optional(),
    NEXT_PUBLIC_SENTRY_DSN: url.optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: url.optional(),
    OTEL_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_POSTHOG_HOST: url.optional(),
    NEXT_PUBLIC_COMMIT_SHA: z.string().min(1).optional(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    requireTogether(r2Keys)(env, ctx);
    requireTogether(ageProviderKeys)(env, ctx);
    if (env.AGE_ASSURANCE_PROVIDER !== undefined && env.AGE_PROVIDER_API_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["AGE_PROVIDER_API_KEY"],
        message: "is required when AGE_ASSURANCE_PROVIDER is set",
      });
    }
    if (env.TURNSTILE_SECRET_KEY !== undefined && env.NEXT_PUBLIC_TURNSTILE_SITE_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
        message: "must be set together with TURNSTILE_SECRET_KEY",
      });
    }
  });

export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadWebEnv(source: EnvSource = process.env): WebEnv {
  const env = loadEnv(webEnvSchema, "web", source);
  assertNoUnexpectedPublicEnv(source);
  return env;
}
