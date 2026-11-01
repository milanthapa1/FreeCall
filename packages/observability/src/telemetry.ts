import type { ErrorEvent } from "@sentry/node";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import { scrubSentryEvent } from "./redact";

/**
 * Telemetry bootstrap for every long-lived process (web, realtime, worker).
 *
 * Rules enforced here rather than by convention:
 * - Nothing is sent when no endpoint/DSN is configured. Local development and tests must
 *   not accidentally ship traces to a shared collector.
 * - OTLP endpoints must be HTTPS in production (loopback sidecars are allowed), and may
 *   not embed credentials in the URL. Credentials belong in headers, which are validated
 *   against header injection.
 * - Sentry is initialised with `sendDefaultPii: false`, no breadcrumbs, and a `beforeSend`
 *   scrubber that removes request data, extras and attachments.
 * - 100% trace sampling is never the default: at a million concurrent callers it is both
 *   unaffordable and useless. The default root ratio is 10%.
 *
 * The heavy SDKs are imported dynamically so that a process that only uses the logger
 * does not pay for them, and so tests can exercise validation without installing global
 * providers.
 */

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
  environment: string;
  release?: string;
  /** OTLP HTTP base URL or a full `/v1/traces` URL. */
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  /** Root trace sampling ratio, 0..1. Default 0.1. */
  tracesSampleRate?: number;
  /** Sentry DSN. Sentry is disabled when absent. */
  sentryDsn?: string;
  /** Sentry performance tracing is off by default; OTel owns traces. */
  sentryTracesSampleRate?: number;
}

export interface TelemetryHandle {
  readonly tracesEnabled: boolean;
  readonly sentryEnabled: boolean;
  /** Flushes and closes both SDKs. Safe to call more than once. */
  shutdown(timeoutMs?: number): Promise<void>;
}

const SERVICE_NAME = /^[a-z][a-z0-9._-]{0,62}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class TelemetryConfigError extends Error {
  constructor(message: string) {
    super(`telemetry misconfigured: ${message}`);
    this.name = "TelemetryConfigError";
  }
}

/**
 * Normalises an OTLP endpoint to the signal-specific traces URL.
 *
 * Accepts `https://collector`, `https://collector/` and
 * `https://collector/v1/traces`, plus collectors mounted under a path
 * (`https://collector/otel`). Query strings and fragments are rejected because collectors
 * do not use them and they are a common place to smuggle credentials into logs.
 */
export function normalizeOtlpTracesUrl(endpoint: string, environment: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) throw new TelemetryConfigError("OTLP endpoint is empty");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TelemetryConfigError(`OTLP endpoint "${trimmed}" is not a valid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TelemetryConfigError("OTLP endpoint must use http or https");
  }
  if (url.username || url.password) {
    throw new TelemetryConfigError(
      "OTLP endpoint must not embed credentials; pass an authorization header instead",
    );
  }
  if (url.search || url.hash) {
    throw new TelemetryConfigError("OTLP endpoint must not contain a query string or fragment");
  }

  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (environment === "production" && url.protocol !== "https:" && !loopback) {
    throw new TelemetryConfigError(
      "OTLP endpoint must use https in production (http is only allowed for a loopback sidecar)",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1/traces") ? path : `${path}/v1/traces`;
  return url.toString();
}

export function assertSampleRate(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TelemetryConfigError(`${name} must be a number between 0 and 1`);
  }
  return value;
}

export async function startTelemetry(options: TelemetryOptions): Promise<TelemetryHandle> {
  const serviceName = options.serviceName.trim();
  if (!SERVICE_NAME.test(serviceName)) {
    throw new TelemetryConfigError(
      `serviceName "${serviceName}" must be lowercase, start with a letter and contain only a-z, 0-9, dot, underscore or hyphen`,
    );
  }

  const environment = options.environment.trim();
  if (!environment) throw new TelemetryConfigError("environment is required");

  const traceSampleRate = assertSampleRate(options.tracesSampleRate ?? 0.1, "tracesSampleRate");
  const sentrySampleRate = assertSampleRate(
    options.sentryTracesSampleRate ?? 0,
    "sentryTracesSampleRate",
  );

  const tracesUrl = options.otlpEndpoint
    ? normalizeOtlpTracesUrl(options.otlpEndpoint, environment)
    : undefined;
  const headers = options.otlpHeaders ? validateHeaders(options.otlpHeaders) : undefined;

  const dsn = options.sentryDsn?.trim() || undefined;
  if (dsn) validateSentryDsn(dsn, environment);

  let sdk: NodeSDK | undefined;
  let sentry: typeof import("@sentry/node") | undefined;

  if (tracesUrl) {
    const [{ NodeSDK: Sdk }, { OTLPTraceExporter }, { defaultResource, resourceFromAttributes }, { ParentBasedSampler, TraceIdRatioBasedSampler }] =
      await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/sdk-trace"),
      ]);

    const resource = defaultResource().merge(
      resourceFromAttributes({
        "deployment.environment.name": environment,
        ...(options.serviceVersion ? { "service.version": options.serviceVersion } : {}),
      }),
    );

    sdk = new Sdk({
      serviceName,
      resource,
      traceExporter: new OTLPTraceExporter({
        url: tracesUrl,
        ...(headers ? { headers } : {}),
        timeoutMillis: 10_000,
      }),
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(traceSampleRate) }),
    });
    sdk.start();
  }

  if (dsn) {
    sentry = await import("@sentry/node");
    sentry.init({
      dsn,
      environment,
      release: options.release ?? options.serviceVersion,
      maxBreadcrumbs: 0,
      /**
       * Sentry v11 replaced `sendDefaultPii` with per-source controls. Everything that
       * can carry user content is off; the event keeps the error, stack, release and
       * environment, which is what makes a crash actionable.
       */
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        frameContextLines: 0,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        mcp: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
      },
      tracesSampleRate: sentrySampleRate,
      beforeSend(event) {
        return scrubSentryEvent(event) as unknown as ErrorEvent | null;
      },
    });
  }

  let closed = false;
  const handle: TelemetryHandle = {
    tracesEnabled: sdk !== undefined,
    sentryEnabled: sentry !== undefined,
    async shutdown(timeoutMs = 2_000): Promise<void> {
      if (closed) return;
      closed = true;
      const timeout = Math.min(Math.max(timeoutMs, 0), 30_000);
      await Promise.allSettled([
        ...(sdk ? [sdk.shutdown()] : []),
        ...(sentry ? [sentry.close(timeout)] : []),
      ]);
    },
  };

  return handle;
}

function validateHeaders(headers: Record<string, string>): Record<string, string> {
  const validated: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) {
      throw new TelemetryConfigError(`OTLP header name "${name}" is not a valid HTTP header name`);
    }
    if (/[\r\n]/.test(value)) {
      throw new TelemetryConfigError(`OTLP header "${name}" contains a line break`);
    }
    validated[name] = value;
  }
  return validated;
}

function validateSentryDsn(dsn: string, environment: string): void {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new TelemetryConfigError("Sentry DSN is not a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TelemetryConfigError("Sentry DSN must use http or https");
  }
  if (environment === "production" && url.protocol !== "https:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TelemetryConfigError(
      "Sentry DSN must use https in production (http is only allowed for a loopback relay)",
    );
  }
}
