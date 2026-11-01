import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { WebEnv } from "@freecall/config";
import { createDb, pingDatabase } from "@freecall/db";
import { Redis } from "ioredis";
import {
  aggregateStatus,
  probeDependency,
  type DependencyHealth,
  type HealthReport,
} from "@freecall/observability";
import { readWebEnv } from "./server-env";

/**
 * Dependency probes for `/api/health`.
 *
 * Every probe creates its own short-lived connection. That is intentional: a health check
 * must never report `up` because a stale pooled connection is still open, and a probe that
 * hangs must not poison a shared client. The cost is one TCP round trip per probe, which
 * is noise at health-check frequency.
 */

const PROBE_TIMEOUT_MS = 2_500;

function version(env: WebEnv | null): string {
  return env?.NEXT_PUBLIC_COMMIT_SHA ?? "dev";
}

function endpointForR2(env: WebEnv): string | null {
  if (
    env.R2_ACCOUNT_ID === undefined ||
    env.R2_ACCESS_KEY_ID === undefined ||
    env.R2_SECRET_ACCESS_KEY === undefined ||
    env.R2_EVIDENCE_BUCKET === undefined
  ) {
    return null;
  }
  return env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

async function checkPostgres(env: WebEnv): Promise<"up" | "not_configured"> {
  const handle = createDb(env.DATABASE_URL, {
    max: 1,
    connectTimeoutSeconds: 2,
    applicationName: "freecall-web-health",
  });
  try {
    const healthy = await pingDatabase(handle.db);
    if (!healthy) throw new Error("postgres ping failed");
    return "up";
  } finally {
    await handle.close({ timeout: 1 }).catch(() => undefined);
  }
}

async function checkRedis(env: WebEnv): Promise<"up" | "not_configured"> {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1_500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    const reply = await client.ping();
    if (reply !== "PONG") throw new Error("redis ping failed");
    return "up";
  } finally {
    client.disconnect();
  }
}

async function checkLiveKit(env: WebEnv): Promise<"up" | "not_configured"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  timer.unref?.();

  try {
    const response = await fetch(new URL("/", env.LIVEKIT_API_URL), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "text/plain" },
    });
    // LiveKit answers `/` with 200 once the node is serving. 401/404 means the process is
    // reachable but not usable, which is a failure, not a degraded state.
    if (!response.ok) throw new Error(`livekit responded ${response.status}`);
    return "up";
  } finally {
    clearTimeout(timer);
  }
}

async function checkStorage(env: WebEnv): Promise<"up" | "not_configured"> {
  const endpoint = endpointForR2(env);
  if (
    endpoint === null ||
    env.R2_ACCESS_KEY_ID === undefined ||
    env.R2_SECRET_ACCESS_KEY === undefined ||
    env.R2_EVIDENCE_BUCKET === undefined
  ) {
    return "not_configured";
  }

  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: env.R2_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: env.R2_EVIDENCE_BUCKET }));
    return "up";
  } finally {
    client.destroy();
  }
}

export async function buildHealthReport(env: WebEnv): Promise<HealthReport> {
  const [postgres, redis, livekit, storage] = await Promise.all([
    probeDependency("postgres", () => checkPostgres(env), { timeoutMs: PROBE_TIMEOUT_MS }),
    probeDependency("redis", () => checkRedis(env), { timeoutMs: PROBE_TIMEOUT_MS }),
    probeDependency("livekit", () => checkLiveKit(env), { timeoutMs: PROBE_TIMEOUT_MS }),
    probeDependency("storage", () => checkStorage(env), { timeoutMs: PROBE_TIMEOUT_MS }),
  ]);

  const dependencies = { postgres, redis, livekit, storage };
  return {
    service: "web",
    version: version(env),
    status: aggregateStatus(Object.values(dependencies)),
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    dependencies,
  };
}

function configurationFailure(): HealthReport {
  const dependency: DependencyHealth = { status: "down", failure: "error" };
  return {
    service: "web",
    version: version(null),
    status: "down",
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: {
      configuration: dependency,
      postgres: dependency,
      redis: dependency,
      livekit: dependency,
      storage: dependency,
    },
  };
}

export async function getHealthReport(): Promise<HealthReport> {
  const result = readWebEnv();
  if (!result.ok) {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "freecall-web",
        event: "health.configuration.invalid",
        errorName: result.errorName,
        errorMessage: result.message,
      })}\n`,
    );
    return configurationFailure();
  }

  try {
    return await buildHealthReport(result.env);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: "freecall-web",
        event: "health.probe.failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })}\n`,
    );
    return configurationFailure();
  }
}
