import { z } from "zod";
import { LIMITS, PROTOCOL_VERSION } from "./limits.js";
import {
  callId,
  countryPreference,
  gender,
  lang,
  locale,
  messageId,
  mode,
  platform,
  reportReason,
  uuid,
} from "./primitives.js";

/**
 * Envelope shared by both directions. Unknown fields are rejected: a client that invents
 * fields is either broken or probing, and either way we want to see it as a protocol error.
 */
function clientEvent<T extends string, D extends z.ZodType>(type: T, data: D) {
  return z.strictObject({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    id: uuid,
    seq: z.number().int().nonnegative().optional(),
    ts: z.number().int().nonnegative().optional(),
    data,
  });
}

const hello = clientEvent(
  "hello",
  z.strictObject({
    token: z.string().min(20).max(4_096),
    client: z.strictObject({
      platform,
      version: z.string().min(1).max(32),
      locale,
    }),
    resume_call_id: callId.optional(),
  }),
);

const ping = clientEvent("ping", z.strictObject({}));

const enqueue = clientEvent(
  "enqueue",
  z.strictObject({
    country: countryPreference,
    mode,
    lang,
    own_gender: gender.optional(),
    strict_gender: z.boolean().default(false),
  }),
);

const skip = clientEvent(
  "skip",
  z.strictObject({
    call_id: callId,
    reason: z.enum(["next", "inappropriate"]),
  }),
);

const stop = clientEvent("stop", z.strictObject({ call_id: callId }));

const chat = clientEvent(
  "chat",
  z.strictObject({
    call_id: callId,
    body: z.string().min(1).max(LIMITS.maxChatChars),
    client_msg_id: messageId,
    translate_to: lang.optional(),
  }),
);

const typing = clientEvent(
  "typing",
  z.strictObject({
    call_id: callId,
    state: z.enum(["start", "stop"]),
  }),
);

const readReceipt = clientEvent(
  "read_receipt",
  z.strictObject({
    call_id: callId,
    up_to_seq: z.number().int().nonnegative(),
  }),
);

const report = clientEvent(
  "report",
  z.strictObject({
    call_id: callId,
    reason: reportReason,
    note: z.string().max(LIMITS.maxReportNoteChars).optional(),
    client_msg_ids: z.array(messageId).max(LIMITS.maxReportMessages).default([]),
    frame_upload_id: uuid.optional(),
  }),
);

const joined = clientEvent(
  "joined",
  z.strictObject({
    call_id: callId,
    room_sid: z.string().max(128).optional(),
  }),
);

const leave = clientEvent("leave", z.strictObject({ call_id: callId }));

/**
 * Reserved for a future voice-only/P2P experiment. The v1 server rejects these with
 * `unsupported_event`; they are in the schema so the rejection is typed and observable
 * rather than a parse failure.
 */
const offer = clientEvent(
  "offer",
  z.strictObject({
    call_id: callId,
    sdp: z.string().min(1).max(LIMITS.maxSdpChars),
  }),
);

const answer = clientEvent(
  "answer",
  z.strictObject({
    call_id: callId,
    sdp: z.string().min(1).max(LIMITS.maxSdpChars),
  }),
);

const ice = clientEvent(
  "ice",
  z.strictObject({
    call_id: callId,
    candidate: z.string().min(1).max(LIMITS.maxIceCandidateChars),
  }),
);

export const clientEventSchema = z.discriminatedUnion("type", [
  hello,
  ping,
  enqueue,
  skip,
  stop,
  chat,
  typing,
  readReceipt,
  report,
  joined,
  leave,
  offer,
  answer,
  ice,
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientEventType = ClientEvent["type"];

export const CLIENT_EVENT_TYPES = [
  "hello",
  "ping",
  "enqueue",
  "skip",
  "stop",
  "chat",
  "typing",
  "read_receipt",
  "report",
  "joined",
  "leave",
  "offer",
  "answer",
  "ice",
] as const satisfies readonly ClientEventType[];

/** Events that are valid in the schema but intentionally not implemented in v1. */
export const UNSUPPORTED_IN_V1: readonly ClientEventType[] = ["offer", "answer", "ice"];
