import { z } from "zod";
import { clientEventSchema, type ClientEvent } from "./client-events.js";
import { LIMITS, SUPPORTED_PROTOCOL_VERSIONS } from "./limits.js";
import { serverEventSchema, type ServerEvent } from "./server-events.js";

export type ProtocolErrorCode =
  | "unsupported_version"
  | "payload_too_large"
  | "unknown_field"
  | "invalid_event";

export interface ProtocolError {
  code: ProtocolErrorCode;
  /** Field paths and reasons. Never echoes the received value. */
  issues: readonly string[];
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProtocolError };

const encoder = new TextEncoder();

export function frameByteLength(raw: string | Uint8Array): number {
  return typeof raw === "string" ? encoder.encode(raw).byteLength : raw.byteLength;
}

export function isFrameTooLarge(raw: string | Uint8Array): boolean {
  return frameByteLength(raw) > LIMITS.maxFrameBytes;
}

/** Reads the envelope version without validating anything else. */
export function readProtocolVersion(input: unknown): number | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)["v"];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function classify(error: z.ZodError): ProtocolError {
  const paths = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });

  const codes = new Set(error.issues.map((issue) => issue.code));

  if (codes.has("unrecognized_keys")) {
    return { code: "unknown_field", issues: paths };
  }
  if (codes.has("too_big")) {
    return { code: "payload_too_large", issues: paths };
  }
  return { code: "invalid_event", issues: paths };
}

export function parseClientEvent(input: unknown): ParseResult<ClientEvent> {
  const version = readProtocolVersion(input);
  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return {
      ok: false,
      error: {
        code: "unsupported_version",
        issues: [`v: expected one of ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`],
      },
    };
  }

  const result = clientEventSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: classify(result.error) };
}

export interface ParsedServerEvent {
  event: ServerEvent;
}

/** Used by clients and by contract tests. Servers should rely on the schema at emit time. */
export function parseServerEvent(input: unknown): ParseResult<ServerEvent> {
  const version = readProtocolVersion(input);
  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return {
      ok: false,
      error: {
        code: "unsupported_version",
        issues: [`v: expected one of ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`],
      },
    };
  }
  const result = serverEventSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: classify(result.error) };
}

/**
 * Rejects duplicate or out-of-order `seq` values on a connection. `seq` is optional, but
 * when a client sends it we hold them to it: this is how replays are detected.
 */
export class SequenceGuard {
  private last = -1;

  accept(seq: number | undefined): boolean {
    if (seq === undefined) return true;
    if (seq <= this.last) return false;
    this.last = seq;
    return true;
  }

  get lastAccepted(): number {
    return this.last;
  }
}
