import { loadRealtimeEnv, type RealtimeEnv } from "@freecall/config";
import {
  createLogger,
  errorFields,
  startTelemetry,
  type Logger,
  type TelemetryHandle,
} from "@freecall/observability";
import Redis from "ioredis";
import { createTokenVerifier } from "./auth.js";
import { startRealtimeHealthServer } from "./health-server.js";
import { startRealtimeServer, type RealtimeServer } from "./server.js";

/**
 * Realtime process entry point.
 *
 * Boot order matters: validate the environment, start telemetry, load the verification key,
 * then accept sockets. A malformed `LIVEKIT_API_SECRET` or a missing `DATABASE_URL` must stop
 * the process before it reports healthy, not after the first user connects.
 */

async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger({
    service: "freecall-realtime",
    environment: env.NODE_ENV,
    version: env.SERVICE_VERSION,
    level: env.LOG_LEVEL,
    bindings: { region: env.REGION },
  });

  const telemetry = await startTelemetry({
    serviceName: "freecall-realtime",
    serviceVersion: env.SERVICE_VERSION,
    environment: env.NODE_ENV,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    tracesSampleRate: env.OTEL_TRACES_SAMPLE_RATE,
    sentryDsn: env.SENTRY_DSN,
  });

  let server: RealtimeServer | null = null;
  let health: Awaited<ReturnType<typeof startRealtimeHealthServer>> | null = null;
  let stopping = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("realtime.shutdown.started", { reasonCode: signal });

    try {
      if (server !== null) await server.drain();
      if (health !== null) await health.close();
    } catch (error) {
      logger.error("realtime.shutdown.failed", errorFields(error));
    } finally {
      await telemetry.shutdown(2_000);
      logger.info("realtime.shutdown.complete", { outcome: "stopped" });
      process.exit(0);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("uncaughtException", (error) => {
    logger.error("realtime.uncaught_exception", errorFields(error));
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("realtime.unhandled_rejection", errorFields(reason));
  });

  try {
    const verifier = await createTokenVerifier(env);
    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    redis.on("error", (err: Error) => {
      logger.error("redis.connection.error", { errorMessage: err.message });
    });
    server = await startRealtimeServer({ env, verifier, logger, redis, databaseUrl: env.DATABASE_URL });
    health = await startRealtimeHealthServer({
      env,
      version: env.SERVICE_VERSION ?? "dev",
      isDraining: () => server?.isDraining ?? true,
      isStopping: () => stopping,
      getSocketCount: () => server?.sessionCount ?? 0,
    });
  } catch (error) {
    logger.error("realtime.boot.failed", errorFields(error));
    await telemetry.shutdown(2_000);
    process.exitCode = 1;
    return;
  }

  logger.info("realtime.boot.complete", {
    outcome: "ready",
    socketCount: server.sessionCount,
  });
}

function loadEnvironment(): RealtimeEnv {
  try {
    return loadRealtimeEnv();
  } catch (error) {
    // Environment errors list variable names and reasons, never values. This is the one
    // place a raw message is printed, because no logger exists yet.
    process.stderr.write(
      `freecall-realtime failed to start\n${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

void main();

// Referenced to keep the type meaningful when this module is imported by tests.
export type RealtimeLogger = Logger;
export type RealtimeTelemetry = TelemetryHandle;
