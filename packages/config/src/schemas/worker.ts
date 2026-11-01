import { z } from "zod";
import {
  booleanDefault,
  nodeEnv,
  positiveInt,
  postgresUrl,
  redisUrl,
  requireTogether,
  secret,
  url,
} from "../primitives.js";
import { loadEnv, type EnvSource } from "../load.js";

const moderationKeys = ["MODERATION_API_KEY", "MODERATION_PROVIDER"] as const;

export const workerEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,

    /** BullMQ queue names (comma-separated override for tests). */
    QUEUE_MODERATION: z.string().min(1).default("freecall:moderation"),
    QUEUE_EVIDENCE: z.string().min(1).default("freecall:evidence"),
    QUEUE_BANS: z.string().min(1).default("freecall:bans"),
    QUEUE_EMAIL: z.string().min(1).default("freecall:email"),
    QUEUE_REPORTS: z.string().min(1).default("freecall:reports"),

    /** Worker concurrency per queue. */
    CONCURRENCY_MODERATION: positiveInt.default(10),
    CONCURRENCY_EVIDENCE: positiveInt.default(5),
    CONCURRENCY_BANS: positiveInt.default(5),
    CONCURRENCY_EMAIL: positiveInt.default(5),
    CONCURRENCY_REPORTS: positiveInt.default(5),

    MODERATION_PROVIDER: z.enum(["hive", "sightengine", "mock"]).optional(),
    MODERATION_API_KEY: z.string().min(1).optional(),
    MODERATION_ENABLED: booleanDefault(true),

    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: secret(16).optional(),
    R2_EVIDENCE_BUCKET: z.string().min(3).optional(),
    R2_ENDPOINT: url.optional(),
    R2_FORCE_PATH_STYLE: booleanDefault(false),

    MAILGUN_API_KEY: secret(16).optional(),
    MAILGUN_DOMAIN: z.string().min(4).optional(),
    MAIL_FROM: z.string().email().optional(),

    SENTRY_DSN: url.optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: url.optional(),
    OTEL_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    SERVICE_VERSION: z.string().min(1).max(64).optional(),
  })
  .superRefine((env, ctx) => {
    requireTogether(moderationKeys)(env, ctx);
    if (env.MODERATION_ENABLED && !env.MODERATION_PROVIDER) {
      // Allow mock provider if not explicitly set (dev mode).
    }
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: EnvSource = process.env): WorkerEnv {
  return loadEnv(workerEnvSchema, "worker", source);
}
