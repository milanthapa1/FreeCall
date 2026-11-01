import { z } from "zod";
import {
  booleanDefault,
  csv,
  duration,
  nodeEnv,
  positiveInt,
  redisUrl,
  region,
  secret,
  url,
} from "../primitives.js";
import { loadEnv, type EnvSource } from "../load.js";

export const realtimeEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    REGION: region.default("iad"),
    WS_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
    REDIS_URL: redisUrl,
    /** Optional — when set, reports are persisted to Postgres. */
    DATABASE_URL: z.string().url().optional(),

    JWT_ISSUER: z.string().min(1).default("freecall"),
    JWT_AUDIENCE: z.string().min(1).default("rt"),
    JWT_ALGORITHM: z.enum(["EdDSA", "ES256", "RS256"]).default("EdDSA"),
    JWT_PUBLIC_KEY: z.string().min(1).optional(),
    JWKS_URL: url.optional(),
    /** Development and test only. Production refuses to boot with this set. */
    JWT_DEV_SECRET: secret(32).optional(),

    LIVEKIT_API_URL: url,
    LIVEKIT_API_KEY: z.string().min(8),
    LIVEKIT_API_SECRET: secret(32),

    CORS_ORIGINS: csv
      .optional()
      .transform((value) => value ?? ["http://localhost:3000"]),
    /** Trust `x-forwarded-for` from the load balancer. Never enable without one. */
    TRUST_PROXY: booleanDefault(false),
    MAX_SOCKETS_PER_POD: positiveInt.default(20_000),
    MAX_SOCKETS_PER_IP: positiveInt.default(10),
    HELLO_TIMEOUT: duration.optional().transform((value) => value ?? 5_000),
    DRAIN_TIMEOUT: duration.optional().transform((value) => value ?? 120_000),
    IDLE_TIMEOUT: duration.optional().transform((value) => value ?? 45_000),
    HEARTBEAT_INTERVAL: duration.optional().transform((value) => value ?? 15_000),

    /** Opaque build identifier reported by /healthz and traces. */
    SERVICE_VERSION: z.string().min(1).max(64).optional(),

    SENTRY_DSN: url.optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: url.optional(),
    OTEL_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    const hasStaticKey = env.JWT_PUBLIC_KEY !== undefined;
    const hasJwks = env.JWKS_URL !== undefined;
    const hasDevSecret = env.JWT_DEV_SECRET !== undefined;

    if (!hasStaticKey && !hasJwks && !hasDevSecret) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_PUBLIC_KEY"],
        message: "one of JWT_PUBLIC_KEY, JWKS_URL or JWT_DEV_SECRET is required",
      });
    }
    if (env.NODE_ENV === "production" && hasDevSecret) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_DEV_SECRET"],
        message: "must not be set in production",
      });
    }
    if (hasStaticKey && hasJwks) {
      ctx.addIssue({
        code: "custom",
        path: ["JWKS_URL"],
        message: "set either JWT_PUBLIC_KEY or JWKS_URL, not both",
      });
    }
  });

export type RealtimeEnv = z.infer<typeof realtimeEnvSchema>;

export function loadRealtimeEnv(source: EnvSource = process.env): RealtimeEnv {
  return loadEnv(realtimeEnvSchema, "realtime", source);
}
