import type { TelemetryHandle } from "@freecall/observability";

/**
 * Next.js calls `register` once per server process, before the first request. This is the
 * web tier's boot gate: a missing or malformed variable stops the process with a message
 * that lists variable names and reasons, never values.
 *
 * During `next build`, runtime secrets are intentionally absent, so validation is skipped.
 * The built artefact is not a running process and must not require production credentials.
 */

const globalForTelemetry = globalThis as typeof globalThis & {
  __freecallWebTelemetry?: TelemetryHandle;
};

export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  if (process.env["NEXT_PHASE"] === "phase-production-build") return;

  const [{ getWebEnv }, { startTelemetry }] = await Promise.all([
    import("./src/lib/server-env"),
    import("@freecall/observability"),
  ]);

  const env = getWebEnv();
  const telemetry = await startTelemetry({
    serviceName: "freecall-web",
    serviceVersion: env.NEXT_PUBLIC_COMMIT_SHA,
    environment: env.NODE_ENV,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    tracesSampleRate: env.OTEL_TRACES_SAMPLE_RATE,
    sentryDsn: env.SENTRY_DSN,
  });

  globalForTelemetry.__freecallWebTelemetry = telemetry;

  process.once("SIGTERM", () => {
    void telemetry.shutdown(2_000);
  });
}
