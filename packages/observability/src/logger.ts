import { redactText } from "./redact";

/**
 * Structured logger with a compile-time and runtime allowlist.
 *
 * Why an allowlist instead of a redaction denylist: a denylist only protects the fields
 * you remembered. Here the only way to attach data is a `LogFields` key that has been
 * reviewed, and values are primitives (no nested objects, no raw request bodies). This
 * makes "we accidentally logged an email address" a type error plus a runtime error, not
 * a code-review miss.
 *
 * Output is one JSON object per line, which is what Loki/Datadog/CloudWatch ingest.
 * Stack traces are deliberately not logged here: they contain filesystem paths and
 * sometimes local variables. Crash reporters receive them through telemetry.ts.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Reviewed log fields. Adding one is a privacy review: would this value ever contain an
 * email, IP, message body, token or free text? If maybe, do not add it.
 */
export const ALLOWED_LOG_FIELDS = [
  "requestId",
  "traceId",
  "spanId",
  "userId",
  "sessionId",
  "callId",
  "reportId",
  "banId",
  "caseId",
  "market",
  "region",
  "route",
  "method",
  "status",
  "outcome",
  "durationMs",
  "count",
  "queueDepth",
  "socketCount",
  "redisLatencyMs",
  "dbLatencyMs",
  "bytes",
  "trustBand",
  "ageTier",
  "policyVersion",
  "provider",
  "model",
  "modelVersion",
  "action",
  "reasonCode",
  "retryable",
  "errorName",
  "errorCode",
  "errorMessage",
  // Phase 2 additions (reviewed: none contain PII)
  "matchedAt",
  "probes",
  "stepIndex",
  "sha",
  "queueKey",
  "peerSessionId",
] as const;

export type LogField = (typeof ALLOWED_LOG_FIELDS)[number];
export type LogValue = string | number | boolean;
export type LogFields = Partial<Record<LogField, LogValue>>;

const ALLOWED_LOG_FIELD_SET: ReadonlySet<string> = new Set(ALLOWED_LOG_FIELDS);

export class LogFieldError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(
      `Log field "${field}" is not on the reviewed allowlist. Add it to ALLOWED_LOG_FIELDS only after a privacy review, or log a different field.`,
    );
    this.name = "LogFieldError";
    this.field = field;
  }
}

export class LogEventNameError extends Error {
  constructor(event: string) {
    super(
      `Log event "${event}" must be a dotted lowercase name such as "http.request.completed".`,
    );
    this.name = "LogEventNameError";
  }
}

export interface LogSink {
  write(line: string): void;
}

export interface LoggerOptions {
  service: string;
  environment: string;
  version?: string;
  level?: LogLevel;
  /** Context attached to every line, e.g. `{ region: "iad" }`. */
  bindings?: LogFields;
  sink?: LogSink;
  now?: () => Date;
}

const EVENT_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export class Logger {
  private readonly service: string;
  private readonly environment: string;
  private readonly version: string | undefined;
  private readonly level: LogLevel;
  private readonly bindings: LogFields;
  private readonly sink: LogSink;
  private readonly now: () => Date;

  constructor(options: LoggerOptions) {
    this.service = options.service;
    this.environment = options.environment;
    this.version = options.version;
    this.level = options.level ?? "info";
    this.bindings = sanitizeFields(options.bindings ?? {});
    this.sink = options.sink ?? {
      write: (line) => {
        process.stdout.write(line);
      },
    };
    this.now = options.now ?? (() => new Date());
  }

  debug(event: string, fields?: LogFields): void {
    this.log("debug", event, fields);
  }

  info(event: string, fields?: LogFields): void {
    this.log("info", event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.log("warn", event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.log("error", event, fields);
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.level];
  }

  /**
   * Returns a logger with additional bound context. Bound context is merged under
   * per-call fields, so a call site can override a binding if it has a more precise value.
   */
  child(bindings: LogFields): Logger {
    return new Logger({
      service: this.service,
      environment: this.environment,
      version: this.version,
      level: this.level,
      bindings: { ...this.bindings, ...bindings },
      sink: this.sink,
      now: this.now,
    });
  }

  private log(level: LogLevel, event: string, fields?: LogFields): void {
    if (!this.isEnabled(level)) return;
    if (event.length > 128 || !EVENT_NAME.test(event)) {
      throw new LogEventNameError(event);
    }

    const safeFields = sanitizeFields(fields ?? {});
    const record: Record<string, LogValue | undefined> = {
      timestamp: this.now().toISOString(),
      level,
      service: this.service,
      environment: this.environment,
      ...(this.version === undefined ? {} : { version: this.version }),
      event,
      ...this.bindings,
      ...safeFields,
    };

    this.sink.write(`${JSON.stringify(record)}\n`);
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}

function sanitizeFields(fields: LogFields): LogFields {
  const safe: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_LOG_FIELD_SET.has(key)) {
      throw new LogFieldError(key);
    }
    if (value === undefined) continue;

    if (typeof value === "string") {
      safe[key as LogField] = redactText(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[key as LogField] = value;
    } else if (typeof value === "boolean") {
      safe[key as LogField] = value;
    } else {
      throw new LogFieldError(key);
    }
  }

  return safe;
}

/**
 * Converts a thrown value into allowlisted, redacted fields. Never logs the stack and
 * never JSON-serializes an unknown error object (which may carry request data).
 */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const rawCode = (error as Error & { code?: unknown }).code;
    const code =
      typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : undefined;

    return {
      errorName: error.name,
      errorMessage: redactText(error.message),
      ...(code === undefined ? {} : { errorCode: code }),
    };
  }

  if (typeof error === "string") {
    return { errorName: "NonErrorThrown", errorMessage: redactText(error) };
  }

  return { errorName: "NonErrorThrown", errorMessage: "unserializable error" };
}
