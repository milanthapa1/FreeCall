import { z } from "zod";
import { LIMITS, PROTOCOL_VERSION } from "./limits.js";
import {
  ageTier,
  banScope,
  callId,
  endReason,
  iso2,
  lang,
  messageId,
  mode,
  reportReason,
  trustBand,
  uuid,
} from "./primitives.js";

function serverEvent<T extends string, D extends z.ZodType>(type: T, data: D) {
  return z.strictObject({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    id: uuid,
    ts: z.number().int().nonnegative(),
    data,
  });
}

const limits = z.strictObject({
  events_per_sec: z.number().int().positive(),
  event_burst: z.number().int().positive(),
  chat_per_sec: z.number().int().positive(),
  typing_per_sec: z.number().int().positive(),
  skip_cooldown_ms: z.number().int().nonnegative(),
  enqueue_cooldown_ms: z.number().int().nonnegative(),
  max_chat_chars: z.number().int().positive(),
  max_frame_bytes: z.number().int().positive(),
});

const helloOk = serverEvent(
  "hello_ok",
  z.strictObject({
    user_id: uuid,
    session_id: uuid,
    server_time: z.number().int().nonnegative(),
    limits,
    features: z.array(z.string().max(64)).max(64),
    resume: z
      .strictObject({
        call_id: callId,
        room_token: z.string().min(1).max(4_096),
        expires_at: z.number().int().nonnegative(),
      })
      .optional(),
  }),
);

const queued = serverEvent(
  "queued",
  z.strictObject({
    position_band: z.enum(["short", "medium", "long"]),
    widening_step: z.number().int().min(0).max(4),
    enqueued_at: z.number().int().nonnegative(),
  }),
);

const matched = serverEvent(
  "matched",
  z.strictObject({
    call_id: callId,
    room: z.string().min(1).max(128),
    room_token: z.string().min(1).max(4_096),
    expires_at: z.number().int().nonnegative(),
    connect_deadline_ms: z.number().int().positive(),
    partner: z.strictObject({
      country: iso2,
      lang,
      mode,
      band: trustBand,
      age_tier: ageTier,
    }),
  }),
);

const callConnected = serverEvent(
  "call_connected",
  z.strictObject({
    call_id: callId,
    connected_at: z.number().int().nonnegative(),
  }),
);

const callFailed = serverEvent(
  "call_failed",
  z.strictObject({
    call_id: callId,
    reason: z.enum(["setup_timeout", "room_unavailable"]),
    retry: z.boolean(),
  }),
);

const callEnded = serverEvent(
  "call_ended",
  z.strictObject({
    call_id: callId,
    end_reason: endReason,
    requeued: z.boolean(),
  }),
);

const partnerLeft = serverEvent(
  "partner_left",
  z.strictObject({
    call_id: callId,
    reason: z.enum(["disconnect", "idle", "error"]),
    reconnect_grace_ms: z.number().int().nonnegative(),
  }),
);

const chat = serverEvent(
  "chat",
  z.strictObject({
    call_id: callId,
    message_id: messageId,
    sender: z.enum(["you", "partner"]),
    body: z.string().min(1).max(LIMITS.maxTranslatedChatChars),
    translated_from: lang.optional(),
    sent_at: z.number().int().nonnegative(),
  }),
);

const chatAck = serverEvent(
  "chat_ack",
  z.strictObject({
    client_msg_id: messageId,
    message_id: messageId.optional(),
    status: z.enum(["delivered", "blocked"]),
    code: z.string().max(64).optional(),
  }),
);

const typing = serverEvent(
  "typing",
  z.strictObject({
    call_id: callId,
    state: z.enum(["start", "stop"]),
  }),
);

const reportAck = serverEvent(
  "report_ack",
  z.strictObject({
    report_id: uuid,
    status: z.enum(["accepted", "duplicate"]),
    evidence: z.enum(["pending", "received"]),
    reason: reportReason.optional(),
  }),
);

const warning = serverEvent(
  "warning",
  z.strictObject({
    code: z.string().min(1).max(64),
    message_key: z.string().min(1).max(128),
    policy_url: z.string().url().optional(),
  }),
);

const ban = serverEvent(
  "ban",
  z.strictObject({
    scope: banScope,
    reason_code: z.string().min(1).max(64),
    expires_at: z.number().int().nonnegative().nullable(),
    appeal_url: z.string().url(),
  }),
);

const draining = serverEvent(
  "draining",
  z.strictObject({
    retry_after_ms: z.number().int().nonnegative(),
    region: z.string().min(2).max(8),
  }),
);

const requeueRequired = serverEvent(
  "requeue_required",
  z.strictObject({
    reason: z.enum(["failover", "region_unavailable"]),
  }),
);

const error = serverEvent(
  "error",
  z.strictObject({
    code: z.enum([
      "invalid_state",
      "rate_limited",
      "age_required",
      "cap_exceeded",
      "already_enqueued",
      "already_in_call",
      "unsupported_event",
      "payload_too_large",
      "unknown_field",
      "invalid_event",
      "unavailable",
      "draining",
    ]),
    message_key: z.string().min(1).max(128),
    retryable: z.boolean(),
    correlation_id: z.string().min(1).max(64),
  }),
);

const pong = serverEvent("pong", z.strictObject({ server_time: z.number().int().nonnegative() }));

export const serverEventSchema = z.discriminatedUnion("type", [
  helloOk,
  queued,
  matched,
  callConnected,
  callFailed,
  callEnded,
  partnerLeft,
  chat,
  chatAck,
  typing,
  reportAck,
  warning,
  ban,
  draining,
  requeueRequired,
  error,
  pong,
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent["type"];

export const SERVER_EVENT_TYPES = [
  "hello_ok",
  "queued",
  "matched",
  "call_connected",
  "call_failed",
  "call_ended",
  "partner_left",
  "chat",
  "chat_ack",
  "typing",
  "report_ack",
  "warning",
  "ban",
  "draining",
  "requeue_required",
  "error",
  "pong",
] as const satisfies readonly ServerEventType[];
