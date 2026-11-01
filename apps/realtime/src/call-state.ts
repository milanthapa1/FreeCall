/**
 * In-memory call state for this pod.
 *
 * Each pod tracks only the calls it is hosting (both sockets connected to this pod).
 * Cross-pod calls are coordinated through Redis (presence, claim, room-id).
 * Calls survive socket disconnects for RECONNECT_WINDOW_MS; after that the call closes.
 */
import { randomUUID } from "node:crypto";

export type CallStatus =
  | "setup"       // matched, waiting for both 'joined'
  | "active"      // both joined; media flowing
  | "closing";    // one side disconnected or stopped; grace period

export interface CallParticipant {
  sid: string;
  userId: string;
  joined: boolean;
  disconnectedAt: number | null;
}

export interface CallRecord {
  callId: string;
  roomName: string;
  a: CallParticipant;
  b: CallParticipant;
  status: CallStatus;
  matchedAt: number;
  connectedAt: number | null;
  /** Timer for connect deadline (setup → fail if not both joined within 8s). */
  connectDeadlineTimer: ReturnType<typeof setTimeout> | null;
  /** Timer for disconnect grace (partner_left after 5s). */
  disconnectGraceTimer: ReturnType<typeof setTimeout> | null;
  /** Timer for reconnect window (close after 10s). */
  reconnectWindowTimer: ReturnType<typeof setTimeout> | null;
}

export class CallStateManager {
  /** callId → record */
  private readonly calls = new Map<string, CallRecord>();
  /** sid → callId */
  private readonly sidToCall = new Map<string, string>();

  /** Generate a new call id (uuid v4). */
  newCallId(): string {
    return randomUUID();
  }

  /**
   * Create a new call in `setup` state.
   * Returns the record; throws if either sid already has an active call.
   */
  createCall(opts: {
    callId: string;
    roomName: string;
    sidA: string;
    userIdA: string;
    sidB: string;
    userIdB: string;
    matchedAt: number;
  }): CallRecord {
    if (this.sidToCall.has(opts.sidA)) {
      throw new Error(`sid ${opts.sidA} already has an active call`);
    }
    if (this.sidToCall.has(opts.sidB)) {
      throw new Error(`sid ${opts.sidB} already has an active call`);
    }

    const record: CallRecord = {
      callId: opts.callId,
      roomName: opts.roomName,
      a: { sid: opts.sidA, userId: opts.userIdA, joined: false, disconnectedAt: null },
      b: { sid: opts.sidB, userId: opts.userIdB, joined: false, disconnectedAt: null },
      status: "setup",
      matchedAt: opts.matchedAt,
      connectedAt: null,
      connectDeadlineTimer: null,
      disconnectGraceTimer: null,
      reconnectWindowTimer: null,
    };

    this.calls.set(opts.callId, record);
    this.sidToCall.set(opts.sidA, opts.callId);
    this.sidToCall.set(opts.sidB, opts.callId);
    return record;
  }

  /** Get a call record by callId. */
  getCall(callId: string): CallRecord | undefined {
    return this.calls.get(callId);
  }

  /** Get a call record by participant sid. */
  getCallBySid(sid: string): CallRecord | undefined {
    const callId = this.sidToCall.get(sid);
    return callId !== undefined ? this.calls.get(callId) : undefined;
  }

  /** Mark a participant as having joined LiveKit. Returns true if both have joined. */
  recordJoin(callId: string, sid: string): boolean {
    const record = this.calls.get(callId);
    if (!record) return false;
    const participant = this.participantBySid(record, sid);
    if (participant) participant.joined = true;
    return record.a.joined && record.b.joined;
  }

  /** Transition a call to active. */
  markActive(callId: string, connectedAt: number): void {
    const record = this.calls.get(callId);
    if (!record) return;
    record.status = "active";
    record.connectedAt = connectedAt;
    this.clearTimer(record, "connectDeadlineTimer");
  }

  /** Mark a participant as disconnected. Returns the partner's sid. */
  recordDisconnect(callId: string, sid: string, at: number): string | null {
    const record = this.calls.get(callId);
    if (!record) return null;
    const participant = this.participantBySid(record, sid);
    if (participant) participant.disconnectedAt = at;
    const partner = record.a.sid === sid ? record.b : record.a;
    return partner.sid;
  }

  /** Remove a call and all its sid mappings. Clears all pending timers. */
  endCall(callId: string): CallRecord | undefined {
    const record = this.calls.get(callId);
    if (!record) return undefined;

    this.clearTimer(record, "connectDeadlineTimer");
    this.clearTimer(record, "disconnectGraceTimer");
    this.clearTimer(record, "reconnectWindowTimer");

    this.sidToCall.delete(record.a.sid);
    this.sidToCall.delete(record.b.sid);
    this.calls.delete(callId);
    return record;
  }

  /** Return count of active call records on this pod. */
  get size(): number {
    return this.calls.size;
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private participantBySid(record: CallRecord, sid: string): CallParticipant | null {
    if (record.a.sid === sid) return record.a;
    if (record.b.sid === sid) return record.b;
    return null;
  }

  private clearTimer(
    record: CallRecord,
    key: "connectDeadlineTimer" | "disconnectGraceTimer" | "reconnectWindowTimer",
  ): void {
    const t = record[key];
    if (t !== null) {
      clearTimeout(t);
      record[key] = null;
    }
  }
}
