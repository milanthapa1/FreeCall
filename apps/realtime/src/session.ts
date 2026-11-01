import type { RealtimeEnv } from "@freecall/config";
import type { Logger } from "@freecall/observability";
import {
  CLOSE_CODES,
  LIMITS,
  RATE_LIMITS,
  SequenceGuard,
  isFrameTooLarge,
  parseClientEvent,
  type ClientEvent,
  type ServerEvent,
} from "@freecall/protocol";
import { randomUUID } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import { AuthError, type TokenVerifier, type VerifiedIdentity } from "./auth.js";
import { CallStateManager } from "./call-state.js";
import { ConnectionRegistry, type CloseableConnection } from "./connections.js";
import { createServerEvent } from "./events.js";
import type { LiveKitClient } from "./livekit.js";
import {
  Matcher,
  CONNECT_DEADLINE_MS,
  DISCONNECT_GRACE_MS,
  RECONNECT_WINDOW_MS,
  type MatchResult,
  type MatchUser,
} from "./matching/index.js";
import type { CrossPodPubSub } from "./pubsub.js";
import { SlidingWindowCounter, TokenBucket } from "./rate-limit.js";

/** Minimal DB interface the session needs — avoids pulling the full @freecall/db in tests. */
export interface ReportWriter {
  writeReport(opts: {
    reportId: string;
    callId: string;
    reporterId: string;
    reportedId: string;
    reason: string;
    note?: string;
    chatMessageIds: string[];
  }): Promise<void>;
}

/**
 * One WebSocket connection and its state machine.
 *
 * Phase 2: Full matchmaking, call lifecycle, chat relay, skip/stop handling,
 * and disconnect grace/reconnect window.
 */

type ErrorCode = Extract<ServerEvent, { type: "error" }>["data"]["code"];

/** Rolling message buffer: last N chat messages for evidence on report. */
const CHAT_BUFFER_SIZE = 50;

export interface SessionDependencies {
  env: RealtimeEnv;
  verifier: TokenVerifier;
  registry: ConnectionRegistry;
  logger: Logger;
  draining: () => boolean;
  matcher: Matcher;
  callState: CallStateManager;
  liveKit: LiveKitClient;
  /** Optional — when present, reports are persisted to the database. */
  reportWriter?: ReportWriter;
  /** Optional — when present, cross-pod match notifications are delivered. */
  pubSub?: CrossPodPubSub;
  /** Called exactly once after the socket has closed. */
  onClosed: () => void;
  now?: () => number;
}

interface ChatMessage {
  messageId: string;
  body: string;
  sender: "you" | "partner";
  sentAt: number;
}

type SessionPhase = "pre_auth" | "idle" | "queued" | "setup" | "active" | "closing";

export class SocketSession implements CloseableConnection {
  private readonly ws: WebSocket;
  private readonly deps: SessionDependencies;
  private readonly now: () => number;
  private readonly sequence = new SequenceGuard();
  private readonly eventBudget: TokenBucket;
  private readonly invalidFrames: SlidingWindowCounter;

  private identity: VerifiedIdentity | null = null;
  private logger: Logger;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAlive = true;
  private closing = false;
  private cleanedUp = false;

  /** Per-call chat rate limiter (1 msg/s, burst 5). Created on match. */
  private chatBucket: TokenBucket | null = null;
  /** Per-call typing rate limiter (1 event/s, burst 3). Created on match. */
  private typingBucket: TokenBucket | null = null;

  /** Current state machine phase. */
  private phase: SessionPhase = "pre_auth";
  /** Current call id (set when matched). */
  private currentCallId: string | null = null;
  /** Rolling chat buffer for evidence. */
  private chatBuffer: ChatMessage[] = [];
  /** Skip flood counter for soft-throttle. */
  private skipCount = 0;
  private skipWindowStart = 0;

  constructor(ws: WebSocket, readonly ip: string, deps: SessionDependencies) {
    this.ws = ws;
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.logger = deps.logger;

    this.eventBudget = new TokenBucket(
      RATE_LIMITS.eventBurst,
      RATE_LIMITS.eventsPerSecond,
      this.now,
    );
    this.invalidFrames = new SlidingWindowCounter(
      RATE_LIMITS.maxInvalidFrames,
      RATE_LIMITS.invalidFrameWindowMs,
      this.now,
    );

    this.helloTimer = setTimeout(() => {
      this.close(CLOSE_CODES.unauthorized, "hello_timeout");
    }, deps.env.HELLO_TIMEOUT);
    this.helloTimer.unref?.();

    this.resetIdleTimer();
    this.startHeartbeat();

    ws.on("message", (data, isBinary) => this.onMessage(data, isBinary));
    ws.on("pong", () => {
      this.heartbeatAlive = true;
    });
    ws.on("error", (error) => {
      this.logger.warn("ws.connection.error", {
        errorName: error.name,
        reasonCode: "socket_error",
      });
      this.terminate();
    });
    ws.on("close", () => this.cleanup());
  }

  get userId(): string | null {
    return this.identity?.userId ?? null;
  }

  get sessionId(): string | null {
    return this.identity?.sessionId ?? null;
  }

  get isAuthenticated(): boolean {
    return this.identity !== null;
  }

  /** Sends a `draining` event and closes. Used on SIGTERM and region evacuation. */
  drain(): void {
    if (this.closing) return;
    this.send(
      createServerEvent("draining", {
        retry_after_ms: 5_000,
        region: this.deps.env.REGION,
      }),
    );
    this.close(CLOSE_CODES.draining, "draining");
  }

  close(code: number, reasonCode: string): void {
    if (this.closing) return;
    this.closing = true;
    this.clearTimers();

    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(code, reasonCode);
    } else {
      this.ws.terminate();
    }
  }

  private terminate(): void {
    if (this.closing) return;
    this.closing = true;
    this.clearTimers();
    this.ws.terminate();
  }

  // ── Message handling ────────────────────────────────────────────────────────

  private onMessage(data: RawData, isBinary: boolean): void {
    if (this.closing) return;
    this.resetIdleTimer();

    if (isBinary) {
      this.recordInvalidFrame();
      this.close(CLOSE_CODES.protocolViolation, "binary_frame");
      return;
    }

    const buffer = toBuffer(data);
    if (isFrameTooLarge(buffer)) {
      this.sendError("payload_too_large", "errors.payload_too_large", false);
      this.recordInvalidFrame();
      return;
    }

    if (!this.eventBudget.tryConsume()) {
      this.sendError("rate_limited", "errors.rate_limited", true);
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(buffer.toString("utf8"));
    } catch {
      this.recordInvalidFrame();
      this.sendError("invalid_event", "errors.invalid_event", false);
      return;
    }

    const parsed = parseClientEvent(raw);
    if (!parsed.ok) {
      if (parsed.error.code === "unsupported_version") {
        this.close(CLOSE_CODES.unsupportedVersion, "unsupported_protocol");
        return;
      }
      this.recordInvalidFrame();
      this.sendError(
        parsed.error.code === "unknown_field"
          ? "unknown_field"
          : parsed.error.code === "payload_too_large"
            ? "payload_too_large"
            : "invalid_event",
        "errors.invalid_event",
        false,
      );
      return;
    }

    const event = parsed.value;
    if (!this.sequence.accept(event.seq)) {
      this.close(CLOSE_CODES.protocolViolation, "replayed_sequence");
      return;
    }

    if (this.deps.draining()) {
      this.close(CLOSE_CODES.draining, "draining");
      return;
    }

    this.dispatch(event);
  }

  private dispatch(event: ClientEvent): void {
    if (!this.isAuthenticated) {
      if (event.type !== "hello") {
        this.close(CLOSE_CODES.protocolViolation, "event_before_hello");
        return;
      }
      void this.handleHello(event);
      return;
    }

    if (event.type === "hello") {
      this.close(CLOSE_CODES.protocolViolation, "duplicate_hello");
      return;
    }

    switch (event.type) {
      case "ping":
        this.send(createServerEvent("pong", { server_time: this.now() }));
        return;
      case "offer":
      case "answer":
      case "ice":
        this.sendError("unsupported_event", "errors.unsupported_event", false);
        return;
      case "enqueue":
        void this.handleEnqueue(event);
        return;
      case "joined":
        void this.handleJoined(event);
        return;
      case "skip":
        void this.handleSkip(event);
        return;
      case "stop":
        void this.handleStop(event);
        return;
      case "chat":
        void this.handleChat(event);
        return;
      case "typing":
        this.handleTyping(event);
        return;
      case "read_receipt":
        // Relay to partner if in call. No ack needed.
        this.relayToPeer((peer) => {
          peer.sendRaw(
            JSON.stringify(
              createServerEvent("typing", {
                call_id: event.data.call_id,
                state: "stop",
              }),
            ),
          );
        });
        return;
      case "report":
        void this.handleReport(event);
        return;
      case "leave":
        void this.handleStop({ type: "stop", id: event.id, v: event.v, data: { call_id: event.data.call_id } });
        return;
    }
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  private async handleHello(event: Extract<ClientEvent, { type: "hello" }>): Promise<void> {
    if (this.helloTimer !== null) {
      clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }

    let identity: VerifiedIdentity;
    try {
      identity = await this.deps.verifier.verify(event.data.token);
    } catch (error) {
      const code = error instanceof AuthError ? error.code : "malformed_token";
      this.logger.warn("ws.auth.failed", { reasonCode: code });
      this.close(CLOSE_CODES.unauthorized, "unauthorized");
      return;
    }

    if (this.closing) return;

    if (this.deps.draining()) {
      this.close(CLOSE_CODES.draining, "draining");
      return;
    }

    this.identity = identity;
    this.logger = this.deps.logger.child({
      userId: identity.userId,
      sessionId: identity.sessionId,
      market: identity.market,
      region: identity.region,
      ageTier: identity.ageTier,
      trustBand: identity.trustBand,
    });

    const replaced = this.deps.registry.bindUser(identity.userId, this);
    replaced?.close(CLOSE_CODES.sessionReplaced, "session_replaced");

    // Also bind session id for peer relay.
    this.deps.registry.bindSession(identity.sessionId, this);

    // Check for a call to resume (client sent resume_call_id in hello).
    const resumeCallId = event.data.resume_call_id;
    if (resumeCallId !== undefined) {
      const call = this.deps.callState.getCall(resumeCallId);
      if (call !== undefined && call.status !== "closing") {
        this.currentCallId = resumeCallId;
        this.phase = "setup";
        // Cancel the reconnect window timer so it doesn't destroy the resumed call.
        if (call.reconnectWindowTimer !== null) {
          clearTimeout(call.reconnectWindowTimer);
          call.reconnectWindowTimer = null;
        }
        if (call.disconnectGraceTimer !== null) {
          clearTimeout(call.disconnectGraceTimer);
          call.disconnectGraceTimer = null;
        }
      }
    }

    this.send(
      createServerEvent("hello_ok", {
        user_id: identity.userId,
        session_id: identity.sessionId,
        server_time: this.now(),
        limits: {
          events_per_sec: RATE_LIMITS.eventsPerSecond,
          event_burst: RATE_LIMITS.eventBurst,
          chat_per_sec: RATE_LIMITS.chatPerSecond,
          typing_per_sec: RATE_LIMITS.typingPerSecond,
          skip_cooldown_ms: RATE_LIMITS.skipCooldownMs,
          enqueue_cooldown_ms: RATE_LIMITS.enqueueCooldownMs,
          max_chat_chars: LIMITS.maxChatChars,
          max_frame_bytes: LIMITS.maxFrameBytes,
        },
        features: ["matchmaking_v2"],
      }),
    );
    this.phase = "idle";

    this.logger.info("ws.connection.ready", {
      socketCount: this.deps.registry.size,
      outcome: "authenticated",
    });
  }

  // ── Matchmaking ─────────────────────────────────────────────────────────────

  private async handleEnqueue(
    event: Extract<ClientEvent, { type: "enqueue" }>,
  ): Promise<void> {
    if (!this.identity) return;

    if (this.phase === "queued") {
      this.sendError("already_enqueued", "errors.already_enqueued", false);
      return;
    }
    if (this.phase === "setup" || this.phase === "active") {
      this.sendError("already_in_call", "errors.already_in_call", false);
      return;
    }
    if (this.identity.ageTier === "t3_locked") {
      this.sendError("age_required", "errors.age_required", false);
      return;
    }

    this.phase = "queued";
    const now = this.now();

    // Skip flood soft-throttle.
    const delayMs = this.computeSkipFloodDelay(now);
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      if (this.closing || this.phase !== "queued") return;
    }

    const user: MatchUser = {
      sid: this.identity.sessionId,
      userId: this.identity.userId,
      region: this.identity.region,
      country: event.data.country === "any" ? "any" : event.data.country,
      lang: event.data.lang,
      mode: event.data.mode,
      ageTier: this.identity.ageTier,
      trustBand: this.identity.trustBand,
      ownGender: event.data.own_gender,
      strictGender: event.data.strict_gender ?? false,
      enqueuedAt: now,
      priorityBoostMs: 0,
    };

    this.send(
      createServerEvent("queued", {
        position_band: "medium",
        widening_step: 0,
        enqueued_at: now,
      }),
    );

    // Subscribe to cross-pod match notifications for this session.
    if (this.deps.pubSub && this.identity) {
      const sid = this.identity.sessionId;
      await this.deps.pubSub.subscribe(sid, (msg) => {
        // Deliver the cross-pod match to this session.
        void this.deps.pubSub?.unsubscribe(sid);
        this.receiveMatchedEvent({
          callId: msg.callId,
          roomName: msg.roomName,
          roomToken: msg.roomToken,
          expiresAt: msg.expiresAt,
          myEntry: { c: msg.peerCountry, l: msg.peerLang, b: 1, t: msg.peerAgeTier },
          peerCountry: msg.peerCountry,
          peerLang: msg.peerLang,
          peerMode: msg.peerMode,
          peerBand: msg.peerBand,
          peerAgeTier: msg.peerAgeTier,
          callIdForState: msg.callId,
        });
      });
    }

    await this.deps.matcher.enqueueUser(user, {
      onMatched: async (me, result) => {
        await this.onMatched(me, result);
      },
      onNoMatch: () => {
        if (this.closing) return;
        this.phase = "idle";
        this.sendError("unavailable", "errors.no_match_found", true);
        this.logger.info("ws.match.no_match", { sessionId: this.identity?.sessionId });
      },
    });
  }

  /** Called by the Matcher when a pair is found. */
  private async onMatched(me: MatchUser, result: MatchResult): Promise<void> {
    if (this.closing || this.phase !== "queued") return;
    if (!this.identity) return;

    const { callState, liveKit, registry } = this.deps;

    // Find peer session by sessionId.
    const peer = registry.getBySessionId(result.peerSid);

    const callId = callState.newCallId();
    let roomName: string;

    try {
      roomName = await liveKit.createRoom(callId);
    } catch (err) {
      this.logger.error("ws.match.room_create_failed", { callId, errorMessage: String(err) });
      this.phase = "idle";
      this.send(
        createServerEvent("call_failed", {
          call_id: callId,
          reason: "room_unavailable",
          retry: true,
        }),
      );
      return;
    }

    let tokens: Awaited<ReturnType<typeof liveKit.mintRoomTokens>>;
    try {
      tokens = await liveKit.mintRoomTokens({
        roomName,
        sidA: me.sid,
        sidB: result.peerSid,
        ageTierA: me.ageTier,
        ageTierB: result.peerEntry.t as "t0_declared" | "t1_estimated" | "t2_verified" | "t3_locked",
      });
    } catch (err) {
      this.logger.error("ws.match.room_token_failed", { callId, errorMessage: String(err) });
      void liveKit.closeRoom(roomName);
      this.phase = "idle";
      const failEvent = createServerEvent("call_failed", {
        call_id: callId,
        reason: "room_unavailable",
        retry: true,
      });
      this.send(failEvent);
      // Notify peer so they don't hang in queued state.
      if (peer instanceof SocketSession) {
        peer.send(failEvent);
        peer.phase = "idle";
      }
      return;
    }

    // Create the call record.
    const peerUserId = peer instanceof SocketSession ? (peer.userId ?? result.peerSid) : result.peerSid;
    try {
      callState.createCall({
        callId,
        roomName,
        sidA: me.sid,
        userIdA: me.userId,
        sidB: result.peerSid,
        userIdB: peerUserId,
        matchedAt: result.matchedAt,
      });
    } catch (err) {
      this.logger.warn("ws.match.create_call_conflict", { callId, errorMessage: String(err) });
      void liveKit.closeRoom(roomName);
      this.phase = "idle";
      return;
    }

    this.currentCallId = callId;
    this.phase = "setup";
    this.chatBuffer = [];
    // Create fresh per-call rate limiters.
    this.chatBucket = new TokenBucket(5, RATE_LIMITS.chatPerSecond, this.now);
    this.typingBucket = new TokenBucket(3, RATE_LIMITS.typingPerSecond, this.now);

    const now = this.now();
    const expiresAt = tokens.expiresAt;

    // Emit `matched` to this side.
    this.send(
      createServerEvent("matched", {
        call_id: callId,
        room: roomName,
        room_token: tokens.tokenA,
        expires_at: expiresAt,
        connect_deadline_ms: CONNECT_DEADLINE_MS,
        partner: {
          country: result.peerEntry.c,
          lang: result.peerEntry.l,
          mode: me.mode,
          band: bandNumToString(result.peerEntry.b),
          age_tier: result.peerEntry.t as "t0_declared" | "t1_estimated" | "t2_verified" | "t3_locked",
        },
      }),
    );

    // Emit `matched` to peer side.
    if (peer instanceof SocketSession) {
      peer.receiveMatchedEvent({
        callId,
        roomName,
        roomToken: tokens.tokenB,
        expiresAt,
        myEntry: result.peerEntry,
        peerCountry: me.country,
        peerLang: me.lang,
        peerMode: me.mode,
        peerBand: me.trustBand,
        peerAgeTier: me.ageTier,
        callIdForState: callId,
      });
    } else if (this.deps.pubSub) {
      // Peer is on a different pod — publish via Redis pub/sub.
      void this.deps.pubSub.publish({
        type: "match_ready",
        targetSid: result.peerSid,
        callId,
        roomName,
        roomToken: tokens.tokenB,
        expiresAt,
        peerCountry: me.country,
        peerLang: me.lang,
        peerMode: me.mode,
        peerBand: me.trustBand,
        peerAgeTier: me.ageTier,
      }).catch((err: unknown) => {
        this.logger.error("ws.match.pubsub_publish_failed", {
          callId,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Start connect deadline timer.
    const call = callState.getCall(callId);
    if (!call) return;
    call.connectDeadlineTimer = setTimeout(async () => {
      const stillSetup = callState.getCall(callId);
      if (!stillSetup || stillSetup.status !== "setup") return;

      this.logger.info("ws.call.connect_timeout", { callId });
      callState.endCall(callId);
      await liveKit.closeRoom(roomName);

      const failEvent = createServerEvent("call_failed", {
        call_id: callId,
        reason: "setup_timeout",
        retry: true,
      });
      this.send(failEvent);
      this.currentCallId = null;
      this.phase = "idle";

      if (peer instanceof SocketSession) {
        peer.send(failEvent);
        peer.currentCallId = null;
        peer.phase = "idle";
      }
    }, CONNECT_DEADLINE_MS);
    call.connectDeadlineTimer.unref?.();

    this.logger.info("ws.match.matched", {
      callId,
      sessionId: me.sid,
      peerSessionId: result.peerSid,
      matchedAt: now,
    });
  }

  /**
   * Called from the peer's onMatched handler to push the matched event to this session.
   */
  receiveMatchedEvent(opts: {
    callId: string;
    roomName: string;
    roomToken: string;
    expiresAt: number;
    myEntry: { c: string; l: string; b: number; t: string };
    peerCountry: string;
    peerLang: string;
    peerMode: "solo" | "couple";
    peerBand: "low" | "normal" | "high";
    peerAgeTier: "t0_declared" | "t1_estimated" | "t2_verified" | "t3_locked";
    callIdForState: string;
  }): void {
    if (this.closing) return;
    this.currentCallId = opts.callId;
    this.phase = "setup";
    this.chatBuffer = [];
    // Create fresh per-call rate limiters.
    this.chatBucket = new TokenBucket(5, RATE_LIMITS.chatPerSecond, this.now);
    this.typingBucket = new TokenBucket(3, RATE_LIMITS.typingPerSecond, this.now);

    this.send(
      createServerEvent("matched", {
        call_id: opts.callId,
        room: opts.roomName,
        room_token: opts.roomToken,
        expires_at: opts.expiresAt,
        connect_deadline_ms: CONNECT_DEADLINE_MS,
        partner: {
          country: opts.peerCountry,
          lang: opts.peerLang,
          mode: opts.peerMode,
          band: opts.peerBand,
          age_tier: opts.peerAgeTier,
        },
      }),
    );
  }

  // ── Call events ─────────────────────────────────────────────────────────────

  private async handleJoined(
    event: Extract<ClientEvent, { type: "joined" }>,
  ): Promise<void> {
    if (this.phase !== "setup" || !this.identity) {
      this.sendError("invalid_state", "errors.not_in_setup", false);
      return;
    }

    const callId = event.data.call_id;
    if (callId !== this.currentCallId) {
      this.sendError("invalid_state", "errors.wrong_call_id", false);
      return;
    }

    const bothJoined = this.deps.callState.recordJoin(callId, this.identity.sessionId);
    this.logger.info("ws.call.joined", {
      callId,
      sessionId: this.identity.sessionId,
      status: bothJoined ? "both" : "single",
    });

    if (bothJoined) {
      const now = this.now();
      this.deps.callState.markActive(callId, now);
      this.phase = "active";

      const connectedEvent = createServerEvent("call_connected", {
        call_id: callId,
        connected_at: now,
      });
      this.send(connectedEvent);

      // Notify peer.
      this.relayToPeer((peer) => {
        peer.phase = "active";
        peer.send(connectedEvent);
      });
    }
  }

  private async handleSkip(event: Extract<ClientEvent, { type: "skip" }>): Promise<void> {
    if (this.phase !== "active" && this.phase !== "setup") {
      this.sendError("invalid_state", "errors.not_in_call", false);
      return;
    }
    if (!this.identity) return;

    const callId = event.data.call_id;
    if (callId !== this.currentCallId) {
      this.sendError("invalid_state", "errors.wrong_call_id", false);
      return;
    }

    this.recordSkip(this.now());
    await this.endCall(callId, "skip", true);
  }

  private async handleStop(event: Extract<ClientEvent, { type: "stop" }>): Promise<void> {
    if (this.phase !== "active" && this.phase !== "setup") {
      this.sendError("invalid_state", "errors.not_in_call", false);
      return;
    }

    const callId = event.data.call_id;
    if (callId !== this.currentCallId) {
      this.sendError("invalid_state", "errors.wrong_call_id", false);
      return;
    }

    await this.endCall(callId, "stop", false);
  }

  private async handleChat(event: Extract<ClientEvent, { type: "chat" }>): Promise<void> {
    if (this.phase !== "active") {
      this.sendError("invalid_state", "errors.not_in_call", false);
      return;
    }
    if (!this.identity) return;

    const callId = event.data.call_id;
    if (callId !== this.currentCallId) {
      this.sendError("invalid_state", "errors.wrong_call_id", false);
      return;
    }

    // Per-call chat rate limit (1 msg/s, burst 5).
    if (this.chatBucket && !this.chatBucket.tryConsume()) {
      this.sendError("rate_limited", "errors.rate_limited", true);
      return;
    }

    const messageId = randomUUID();
    const now = this.now();
    const body = event.data.body.slice(0, LIMITS.maxChatChars);

    // Acknowledge to sender.
    this.send(
      createServerEvent("chat_ack", {
        client_msg_id: event.data.client_msg_id,
        message_id: messageId,
        status: "delivered",
      }),
    );

    // Echo to sender (as "you").
    this.send(
      createServerEvent("chat", {
        call_id: callId,
        message_id: messageId,
        sender: "you",
        body,
        sent_at: now,
      }),
    );

    // Buffer message.
    this.pushChatMessage({ messageId, body, sender: "you", sentAt: now });

    // Relay to partner (as "partner").
    this.relayToPeer((peer) => {
      const partnerMsg = createServerEvent("chat", {
        call_id: callId,
        message_id: messageId,
        sender: "partner",
        body,
        sent_at: now,
      });
      peer.send(partnerMsg);
      peer.pushChatMessage({ messageId, body, sender: "partner", sentAt: now });
    });
  }

  private handleTyping(event: Extract<ClientEvent, { type: "typing" }>): void {
    if (this.phase !== "active") return;

    const callId = event.data.call_id;
    if (callId !== this.currentCallId) return;

    // Per-call typing rate limit (1 event/s, burst 3).
    if (this.typingBucket && !this.typingBucket.tryConsume()) return;

    this.relayToPeer((peer) => {
      peer.send(
        createServerEvent("typing", {
          call_id: callId,
          state: event.data.state,
        }),
      );
    });
  }

  private async handleReport(event: Extract<ClientEvent, { type: "report" }>): Promise<void> {
    if (this.phase !== "active" && this.phase !== "setup") {
      this.sendError("invalid_state", "errors.not_in_call", false);
      return;
    }
    if (!this.identity) return;

    const callId = event.data.call_id;
    if (callId !== this.currentCallId) {
      this.sendError("invalid_state", "errors.wrong_call_id", false);
      return;
    }

    // Resolve who was reported (the peer).
    const call = this.deps.callState.getCall(callId);
    const mySid = this.identity.sessionId;
    const peerSid = call ? (call.a.sid === mySid ? call.b.sid : call.a.sid) : null;
    const peerSession = peerSid ? this.deps.registry.getBySessionId(peerSid) : null;
    const reportedId =
      peerSession instanceof SocketSession
        ? (peerSession.userId ?? peerSid ?? "unknown")
        : (peerSid ?? "unknown");

    const reportId = randomUUID();

    this.logger.info("ws.report.received", {
      reportId,
      callId,
      reasonCode: event.data.reason,
      count: event.data.client_msg_ids.length,
    });

    // Persist to database (best-effort — never block the ack on DB latency).
    if (this.deps.reportWriter) {
      this.deps.reportWriter
        .writeReport({
          reportId,
          callId,
          reporterId: this.identity.userId,
          reportedId,
          reason: event.data.reason,
          note: event.data.note,
          chatMessageIds: event.data.client_msg_ids,
        })
        .catch((err: unknown) => {
          this.logger.error("ws.report.persist_failed", {
            reportId,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        });
    }

    this.send(
      createServerEvent("report_ack", {
        report_id: reportId,
        status: "accepted",
        evidence: "pending",
        reason: event.data.reason,
      }),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async endCall(
    callId: string,
    reason: "skip" | "stop" | "disconnect",
    requeue: boolean,
  ): Promise<void> {
    const { callState, liveKit } = this.deps;
    const call = callState.endCall(callId);
    if (!call) return;

    const prevPhase = this.phase;
    this.phase = "idle";
    this.currentCallId = null;

    void liveKit.closeRoom(call.roomName);

    this.send(
      createServerEvent("call_ended", {
        call_id: callId,
        end_reason: reason,
        requeued: requeue,
      }),
    );

    this.relayToPeerBySids(call.a.sid, call.b.sid, (peer) => {
      peer.send(
        createServerEvent("call_ended", {
          call_id: callId,
          end_reason: reason === "skip" ? "partner_left" : reason,
          requeued: false,
        }),
      );
      peer.currentCallId = null;
      peer.phase = "idle";
    });

    this.logger.info("ws.call.ended", {
      callId,
      reasonCode: reason,
      durationMs: prevPhase === "active" && call.connectedAt !== null
        ? this.now() - call.connectedAt
        : 0,
    });
  }

  private handleDisconnectDuringCall(callId: string): void {
    const { callState, liveKit } = this.deps;
    const call = callState.getCall(callId);
    if (!call) return;
    if (!this.identity) return;

    const sid = this.identity.sessionId;
    const now = this.now();

    callState.recordDisconnect(callId, sid, now);

    call.disconnectGraceTimer = setTimeout(() => {
      const stillAlive = callState.getCall(callId);
      if (!stillAlive) return;

      this.relayToPeerBySids(call.a.sid, call.b.sid, (peer) => {
        peer.send(
          createServerEvent("partner_left", {
            call_id: callId,
            reason: "disconnect",
            reconnect_grace_ms: RECONNECT_WINDOW_MS - DISCONNECT_GRACE_MS,
          }),
        );
      });

      call.reconnectWindowTimer = setTimeout(() => {
        const stillAlive2 = callState.getCall(callId);
        if (!stillAlive2) return;
        callState.endCall(callId);
        void liveKit.closeRoom(call.roomName);
        this.logger.info("ws.call.reconnect_timeout", { callId });
      }, RECONNECT_WINDOW_MS - DISCONNECT_GRACE_MS);
      call.reconnectWindowTimer.unref?.();
    }, DISCONNECT_GRACE_MS);
    call.disconnectGraceTimer.unref?.();
  }

  sendRaw(json: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(json);
  }

  private relayToPeer(action: (peer: SocketSession) => void): void {
    if (!this.currentCallId || !this.identity) return;
    const call = this.deps.callState.getCall(this.currentCallId);
    if (!call) return;
    const mySid = this.identity.sessionId;
    const peerSid = call.a.sid === mySid ? call.b.sid : call.a.sid;
    const peerConn = this.deps.registry.getBySessionId(peerSid);
    if (peerConn instanceof SocketSession) action(peerConn);
  }

  private relayToPeerBySids(
    sidA: string,
    sidB: string,
    action: (peer: SocketSession) => void,
  ): void {
    if (!this.identity) return;
    const mySid = this.identity.sessionId;
    const peerSid = sidA === mySid ? sidB : sidA;
    const peerConn = this.deps.registry.getBySessionId(peerSid);
    if (peerConn instanceof SocketSession) action(peerConn);
  }

  private pushChatMessage(msg: ChatMessage): void {
    this.chatBuffer.push(msg);
    if (this.chatBuffer.length > CHAT_BUFFER_SIZE) {
      this.chatBuffer.shift();
    }
  }

  private computeSkipFloodDelay(now: number): number {
    const windowMs = 60_000;
    if (now - this.skipWindowStart > windowMs) {
      this.skipWindowStart = now;
      this.skipCount = 0;
    }
    if (this.skipCount <= 6) return 0;
    return Math.min((this.skipCount - 6) * 1_000, 10_000);
  }

  private recordSkip(now: number): void {
    const windowMs = 60_000;
    if (now - this.skipWindowStart > windowMs) {
      this.skipWindowStart = now;
      this.skipCount = 0;
    }
    this.skipCount++;
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  private send(event: ServerEvent): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  private sendError(code: ErrorCode, messageKey: string, retryable: boolean): void {
    this.send(
      createServerEvent("error", {
        code,
        message_key: messageKey,
        retryable,
        correlation_id: randomUUID(),
      }),
    );
  }

  private recordInvalidFrame(): void {
    if (this.invalidFrames.record()) {
      this.close(CLOSE_CODES.repeatedInvalidFrames, "invalid_frames");
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.close(CLOSE_CODES.idleTimeout, "idle_timeout");
    }, this.deps.env.IDLE_TIMEOUT);
    this.idleTimer.unref?.();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      if (!this.heartbeatAlive) {
        this.logger.warn("ws.connection.unresponsive", { reasonCode: "heartbeat_timeout" });
        this.terminate();
        return;
      }
      this.heartbeatAlive = false;
      this.ws.ping();
    }, this.deps.env.HEARTBEAT_INTERVAL);
    this.heartbeatTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.helloTimer !== null) clearTimeout(this.helloTimer);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.helloTimer = null;
    this.idleTimer = null;
    this.heartbeatTimer = null;
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.closing = true;
    this.clearTimers();

    if (this.currentCallId && (this.phase === "active" || this.phase === "setup")) {
      this.handleDisconnectDuringCall(this.currentCallId);
    }

    if (this.phase === "queued" && this.identity) {
      void this.deps.matcher.dequeueUser(this.identity.sessionId);
      void this.deps.pubSub?.unsubscribe(this.identity.sessionId);
    }

    if (this.identity !== null) {
      this.deps.registry.unbindUser(this.identity.userId, this);
      this.deps.registry.unbindSession(this.identity.sessionId, this);
    }
    this.deps.onClosed();

    this.logger.info("ws.connection.closed", {
      socketCount: this.deps.registry.size,
      outcome: this.identity === null ? "unauthenticated" : "closed",
    });
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function bandNumToString(b: number): "low" | "normal" | "high" {
  if (b === 0) return "low";
  if (b === 2) return "high";
  return "normal";
}
