/**
 * Worker process entry point.
 *
 * Starts BullMQ workers for moderation, evidence assembly, bans, email, and reports.
 * Boot order: validate env → connect Redis → connect DB → load moderation provider →
 * start workers → report healthy.
 */

import { loadWorkerEnv } from "@freecall/config";
import {
  createLogger,
  errorFields,
  startTelemetry,
} from "@freecall/observability";
import { createDb } from "@freecall/db";
import { HiveModerationProvider, MockModerationProvider } from "@freecall/moderation";
import { EvidenceStorage } from "@freecall/providers";
import { Worker, Queue } from "bullmq";
import Redis from "ioredis";
import { processModerationJob } from "./processors/moderation.js";
import { processEvidenceJob } from "./processors/evidence.js";
import { processBanJob } from "./processors/bans.js";
import { QUEUE_NAMES, type BanJob, type EvidenceJob, type ModerationJob } from "./queues.js";

async function main(): Promise<void> {
  // ── Environment ──────────────────────────────────────────────────────────
  let env;
  try {
    env = loadWorkerEnv();
  } catch (error) {
    process.stderr.write(
      `freecall-worker failed to start\n${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const logger = createLogger({
    service: "freecall-worker",
    environment: env.NODE_ENV,
    version: env.SERVICE_VERSION,
    level: env.LOG_LEVEL,
  });

  const telemetry = await startTelemetry({
    serviceName: "freecall-worker",
    serviceVersion: env.SERVICE_VERSION,
    environment: env.NODE_ENV,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    tracesSampleRate: env.OTEL_TRACES_SAMPLE_RATE,
    sentryDsn: env.SENTRY_DSN,
  });

  // ── Infrastructure ────────────────────────────────────────────────────────
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ requirement
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on("error", (err: Error) => {
    logger.error("redis.connection.error", { errorMessage: err.message });
  });

  const { db } = createDb(env.DATABASE_URL, {
    max: env.CONCURRENCY_MODERATION + env.CONCURRENCY_EVIDENCE + env.CONCURRENCY_BANS + 5,
    applicationName: "freecall-worker",
  });

  // ── Moderation provider ───────────────────────────────────────────────────
  const moderationProvider =
    env.MODERATION_PROVIDER === "hive" && env.MODERATION_API_KEY
      ? new HiveModerationProvider(env.MODERATION_API_KEY)
      : new MockModerationProvider();

  logger.info("worker.provider.loaded", { provider: moderationProvider.name });

  // ── Storage ───────────────────────────────────────────────────────────────
  const storage =
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_EVIDENCE_BUCKET
      ? new EvidenceStorage({
          accountId: env.R2_ACCOUNT_ID,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          bucket: env.R2_EVIDENCE_BUCKET,
          endpoint: env.R2_ENDPOINT,
          forcePathStyle: env.R2_FORCE_PATH_STYLE,
        })
      : null;

  // ── Queues ─────────────────────────────────────────────────────────────────
  const bansQueue = new Queue<BanJob>(QUEUE_NAMES.bans, { connection: redis });

  // ── Workers ───────────────────────────────────────────────────────────────
  const workers: Worker[] = [];

  // Moderation worker
  if (env.MODERATION_ENABLED) {
    const moderationWorker = new Worker<ModerationJob>(
      QUEUE_NAMES.moderation,
      async (job) =>
        processModerationJob(job, {
          db,
          provider: moderationProvider,
          bansQueue,
          logger,
          policyVersion: env.SERVICE_VERSION ?? "dev",
        }),
      {
        connection: redis,
        concurrency: env.CONCURRENCY_MODERATION,
      },
    );
    moderationWorker.on("failed", (job, err) => {
      logger.error("worker.job.failed", {
        reasonCode: QUEUE_NAMES.moderation,
        requestId: job?.id ?? "unknown",
        errorMessage: err.message,
      });
    });
    workers.push(moderationWorker);
  }

  // Evidence worker
  if (storage) {
    const evidenceWorker = new Worker<EvidenceJob>(
      QUEUE_NAMES.evidence,
      async (job) => processEvidenceJob(job, { db, storage, logger }),
      {
        connection: redis,
        concurrency: env.CONCURRENCY_EVIDENCE,
      },
    );
    evidenceWorker.on("failed", (job, err) => {
      logger.error("worker.job.failed", {
        reasonCode: QUEUE_NAMES.evidence,
        requestId: job?.id ?? "unknown",
        errorMessage: err.message,
      });
    });
    workers.push(evidenceWorker);
  }

  // Bans worker
  const bansWorker = new Worker<BanJob>(
    QUEUE_NAMES.bans,
    async (job) => processBanJob(job, { db, redis, logger }),
    {
      connection: redis,
      concurrency: env.CONCURRENCY_BANS,
    },
  );
  bansWorker.on("failed", (job, err) => {
    logger.error("worker.job.failed", {
      reasonCode: QUEUE_NAMES.bans,
      requestId: job?.id ?? "unknown",
      errorMessage: err.message,
    });
  });
  workers.push(bansWorker);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("worker.shutdown.started", { reasonCode: signal });

    await Promise.all(workers.map((w) => w.close()));
    await bansQueue.close();
    redis.disconnect();
    await telemetry.shutdown(2_000);

    logger.info("worker.shutdown.complete", { outcome: "stopped" });
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("uncaughtException", (error) => {
    logger.error("worker.uncaught_exception", errorFields(error));
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("worker.unhandled_rejection", errorFields(reason));
  });

  logger.info("worker.boot.complete", {
    outcome: "ready",
    provider: moderationProvider.name,
    count: workers.length,
  });
}

void main();
