import { describe, expect, it } from "vitest";
import {
  CLIENT_EVENT_TYPES,
  LIMITS,
  PROTOCOL_VERSION,
  SERVER_EVENT_TYPES,
  SequenceGuard,
  frameByteLength,
  isFrameTooLarge,
  parseClientEvent,
  parseServerEvent,
  type ClientEventType,
  type ServerEventType,
} from "../src/index";

const ID = "0190a5c0-0000-7000-8000-000000000001";
const CALL = "0190a5c0-0000-7000-8000-0000000000c1";
const MSG = "0190a5c0-0000-7000-8000-0000000000m1".replace("m", "a");

function ev(type: string, data: unknown, extra: Record<string, unknown> = {}) {
  return { v: PROTOCOL_VERSION, type, id: ID, seq: 1, ts: 1_761_780_000_000, data, ...extra };
}

const clientFixtures: Record<ClientEventType, unknown> = {
  hello: ev("hello", {
    token: "t".repeat(40),
    client: { platform: "web", version: "1.0.0", locale: "en" },
  }),
  ping: ev("ping", {}),
  enqueue: ev("enqueue", { country: "any", mode: "solo", lang: "en", own_gender: "x" }),
  skip: ev("skip", { call_id: CALL, reason: "next" }),
  stop: ev("stop", { call_id: CALL }),
  chat: ev("chat", { call_id: CALL, body: "hello", client_msg_id: MSG, translate_to: "es" }),
  typing: ev("typing", { call_id: CALL, state: "start" }),
  read_receipt: ev("read_receipt", { call_id: CALL, up_to_seq: 3 }),
  report: ev("report", { call_id: CALL, reason: "nudity", client_msg_ids: [MSG] }),
  joined: ev("joined", { call_id: CALL }),
  leave: ev("leave", { call_id: CALL }),
  offer: ev("offer", { call_id: CALL, sdp: "v=0" }),
  answer: ev("answer", { call_id: CALL, sdp: "v=0" }),
  ice: ev("ice", { call_id: CALL, candidate: "candidate:1" }),
};

const partner = { country: "DE", lang: "de", mode: "solo", band: "normal", age_tier: "t1_estimated" };
const limits = {
  events_per_sec: 8,
  event_burst: 20,
  chat_per_sec: 1,
  typing_per_sec: 1,
  skip_cooldown_ms: 2000,
  enqueue_cooldown_ms: 3000,
  max_chat_chars: 500,
  max_frame_bytes: 16384,
};

function sv(type: string, data: unknown) {
  return { v: PROTOCOL_VERSION, type, id: ID, ts: 1_761_780_000_000, data };
}

const serverFixtures: Record<ServerEventType, unknown> = {
  hello_ok: sv("hello_ok", {
    user_id: ID,
    session_id: ID,
    server_time: 1_761_780_000_000,
    limits,
    features: [],
  }),
  queued: sv("queued", { position_band: "short", widening_step: 0, enqueued_at: 1 }),
  matched: sv("matched", {
    call_id: CALL,
    room: "call_abc",
    room_token: "jwt",
    expires_at: 1,
    connect_deadline_ms: 8000,
    partner,
  }),
  call_connected: sv("call_connected", { call_id: CALL, connected_at: 1 }),
  call_failed: sv("call_failed", { call_id: CALL, reason: "setup_timeout", retry: true }),
  call_ended: sv("call_ended", { call_id: CALL, end_reason: "skip", requeued: false }),
  partner_left: sv("partner_left", { call_id: CALL, reason: "disconnect", reconnect_grace_ms: 10000 }),
  chat: sv("chat", {
    call_id: CALL,
    message_id: MSG,
    sender: "partner",
    body: "hola",
    translated_from: "de",
    sent_at: 1,
  }),
  chat_ack: sv("chat_ack", { client_msg_id: MSG, message_id: MSG, status: "delivered" }),
  typing: sv("typing", { call_id: CALL, state: "stop" }),
  report_ack: sv("report_ack", { report_id: ID, status: "accepted", evidence: "pending" }),
  warning: sv("warning", { code: "camera_off", message_key: "chat.cameraOff" }),
  ban: sv("ban", {
    scope: "platform",
    reason_code: "minor_risk",
    expires_at: null,
    appeal_url: "https://example.com/appeal",
  }),
  draining: sv("draining", { retry_after_ms: 4000, region: "iad" }),
  requeue_required: sv("requeue_required", { reason: "failover" }),
  error: sv("error", {
    code: "rate_limited",
    message_key: "errors.rateLimited",
    retryable: true,
    correlation_id: "req_123",
  }),
  pong: sv("pong", { server_time: 1 }),
};

describe("client events", () => {
  it("covers every declared event type", () => {
    expect(Object.keys(clientFixtures).sort()).toEqual([...CLIENT_EVENT_TYPES].sort());
  });

  for (const type of CLIENT_EVENT_TYPES) {
    it(`accepts a valid ${type}`, () => {
      const result = parseClientEvent(clientFixtures[type]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe(type);
    });
  }

  it("rejects unknown fields", () => {
    const fixture = ev("chat", {
      call_id: CALL,
      body: "hi",
      client_msg_id: MSG,
      is_admin: true,
    });
    const result = parseClientEvent(fixture);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_field");
      expect(result.error.issues.join(" ")).toContain("is_admin");
    }
  });

  it("rejects a chat body above the limit as payload_too_large", () => {
    const result = parseClientEvent(
      ev("chat", { call_id: CALL, body: "x".repeat(LIMITS.maxChatChars + 1), client_msg_id: MSG }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("payload_too_large");
  });

  it("rejects an unsupported protocol version before parsing fields", () => {
    const result = parseClientEvent({ ...(clientFixtures.ping as object), v: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported_version");
  });

  it("rejects a structurally invalid envelope without throwing", () => {
    const result = parseClientEvent({ v: 1, type: "chat" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_event");
  });

  it("rejects a lowercase country code", () => {
    const result = parseClientEvent(
      ev("enqueue", { country: "de", mode: "solo", lang: "en" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("server events", () => {
  it("covers every declared event type", () => {
    expect(Object.keys(serverFixtures).sort()).toEqual([...SERVER_EVENT_TYPES].sort());
  });

  for (const type of SERVER_EVENT_TYPES) {
    it(`accepts a valid ${type}`, () => {
      const result = parseServerEvent(serverFixtures[type]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe(type);
    });
  }

  it("rejects a matched event that would leak an unexpected partner field", () => {
    const fixture = serverFixtures.matched as { data: Record<string, unknown> };
    const result = parseServerEvent({
      ...(serverFixtures.matched as object),
      data: { ...fixture.data, partner: { ...partner, email: "a@b.c" } },
    });
    expect(result.ok).toBe(false);
  });
});

describe("frame limits", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(frameByteLength("é")).toBe(2);
    expect(isFrameTooLarge("x".repeat(LIMITS.maxFrameBytes))).toBe(false);
    expect(isFrameTooLarge("x".repeat(LIMITS.maxFrameBytes + 1))).toBe(true);
    expect(isFrameTooLarge("é".repeat(LIMITS.maxFrameBytes / 2 + 1))).toBe(true);
  });
});

describe("sequence guard", () => {
  it("accepts increasing sequences and rejects replays", () => {
    const guard = new SequenceGuard();
    expect(guard.accept(0)).toBe(true);
    expect(guard.accept(1)).toBe(true);
    expect(guard.accept(1)).toBe(false);
    expect(guard.accept(0)).toBe(false);
    expect(guard.accept(undefined)).toBe(true);
    expect(guard.lastAccepted).toBe(1);
  });
});

describe("versioning guards", () => {
  it("fails when an event type is added without updating this contract test", () => {
    expect([...CLIENT_EVENT_TYPES]).toEqual([
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
    ]);
    expect([...SERVER_EVENT_TYPES]).toEqual([
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
    ]);
  });
});
