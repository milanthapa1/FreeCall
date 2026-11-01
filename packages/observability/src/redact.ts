/**
 * Privacy-first text redaction. Logs, crash reports and analytics properties all pass
 * through here before they leave the process. It is deliberately conservative: an
 * over-redacted log line is a debugging annoyance, a leaked email or session token is an
 * incident.
 *
 * This is a safety net, not a licence to log raw request bodies. Fields are already
 * allowlisted at the logger boundary (see logger.ts); this catches the case where a
 * value that should be safe turns out to contain user data.
 */

const CREDENTIALS_IN_URL =
  /\b(postgres(?:ql)?|redis|rediss|https?|wss?):\/\/[^\s:@/]+:[^\s@/]+@/gi;

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** Full form: eight groups. Compressed form always contains `::`. */
const IPV6_FULL = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi;
const IPV6_COMPRESSED = /\b(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4})?\b/gi;

/** Phone numbers, card numbers, national IDs: 12+ contiguous digits/separators. */
const LONG_NUMBER = /\b\d[\d -]{11,}\d\b/g;

export const REDACTIONS = [
  "credentials",
  "jwt",
  "token",
  "email",
  "ip",
  "number",
] as const;

export type RedactionKind = (typeof REDACTIONS)[number];

export function redactedMarker(kind: RedactionKind): string {
  return `[redacted:${kind}]`;
}

export function redactText(input: string): string {
  return input
    .replace(CREDENTIALS_IN_URL, (_match, scheme: string) => {
      return `${scheme}://${redactedMarker("credentials")}@`;
    })
    .replace(JWT, redactedMarker("jwt"))
    .replace(BEARER_TOKEN, `Bearer ${redactedMarker("token")}`)
    .replace(EMAIL, redactedMarker("email"))
    .replace(IPV4, redactedMarker("ip"))
    .replace(IPV6_FULL, redactedMarker("ip"))
    .replace(IPV6_COMPRESSED, redactedMarker("ip"))
    .replace(LONG_NUMBER, redactedMarker("number"));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Sentry events can carry request headers (cookies, Authorization), form bodies, custom
 * extras and breadcrumbs. None of that is worth the privacy risk, so it is removed
 * wholesale. We keep the error type/value (redacted), stack traces, release and runtime
 * context, which is what actually makes a crash actionable.
 */
export function scrubSentryEvent(event: unknown): Record<string, unknown> {
  const input = asRecord(event);
  if (!input) return {};

  const scrubbed: Record<string, unknown> = { ...input };

  delete scrubbed["request"];
  delete scrubbed["extra"];
  delete scrubbed["breadcrumbs"];
  delete scrubbed["attachments"];

  const user = asRecord(input["user"]);
  if (user && typeof user["id"] === "string") {
    scrubbed["user"] = { id: user["id"] };
  } else {
    delete scrubbed["user"];
  }

  if (typeof input["message"] === "string") {
    scrubbed["message"] = redactText(input["message"]);
  }
  if (typeof input["transaction"] === "string") {
    scrubbed["transaction"] = redactText(input["transaction"]);
  }

  const tags = asRecord(input["tags"]);
  if (tags) {
    const safeTags: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags)) {
      if (typeof value === "string") safeTags[key] = redactText(value);
    }
    scrubbed["tags"] = safeTags;
  }

  const exception = asRecord(input["exception"]);
  const values = exception?.["values"];
  if (Array.isArray(values)) {
    scrubbed["exception"] = {
      ...exception,
      values: values.map((entry) => {
        const record = asRecord(entry);
        if (!record) return { value: "[unserializable exception entry]" };
        return {
          ...record,
          ...(typeof record["value"] === "string"
            ? { value: redactText(record["value"]) }
            : {}),
        };
      }),
    };
  }

  return scrubbed;
}
