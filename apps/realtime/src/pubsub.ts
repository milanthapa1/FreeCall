/**
 * Cross-pod match notification via Redis pub/sub.
 *
 * When the Lua script matches two users, only the pod that ran the script has both
 * SocketSession objects in memory. The peer may be connected to a different pod.
 * This module broadcasts a "match_ready" message on a per-session channel so the
 * peer pod can deliver the matched event to its local session.
 *
 * Channel: mm:match:{sid}
 * Message: JSON-serialised CrossPodMatchMessage
 *
 * Each pod subscribes to the channels of its own sessions at enqueue time and
 * unsubscribes at dequeue/disconnect time.
 */
import type Redis from "ioredis";
import type { Logger } from "@freecall/observability";

export interface CrossPodMatchMessage {
  type: "match_ready";
  /** The session that should receive this match. */
  targetSid: string;
  callId: string;
  roomName: string;
  roomToken: string;
  expiresAt: number;
  peerCountry: string;
  peerLang: string;
  peerMode: "solo" | "couple";
  peerBand: "low" | "normal" | "high";
  peerAgeTier: "t0_declared" | "t1_estimated" | "t2_verified" | "t3_locked";
}

export type CrossPodMatchHandler = (msg: CrossPodMatchMessage) => void;

/** Channel name for a given session id. */
export function matchChannel(sid: string): string {
  return `mm:match:${sid}`;
}

/**
 * A Redis pub/sub manager scoped to this pod.
 *
 * Uses a dedicated subscriber connection (ioredis pattern — a subscribed client
 * can only issue subscribe/unsubscribe/psubscribe commands).
 */
export class CrossPodPubSub {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly logger: Logger;
  /** sid → handler registered by this pod. */
  private readonly handlers = new Map<string, CrossPodMatchHandler>();

  constructor(publisher: Redis, subscriber: Redis, logger: Logger) {
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.logger = logger;

    this.subscriber.on("message", (channel: string, message: string) => {
      this.onMessage(channel, message);
    });

    this.subscriber.on("error", (err: Error) => {
      this.logger.warn("pubsub.subscriber.error", { errorMessage: err.message });
    });
  }

  /** Subscribe to match notifications for this session. */
  async subscribe(sid: string, handler: CrossPodMatchHandler): Promise<void> {
    this.handlers.set(sid, handler);
    await this.subscriber.subscribe(matchChannel(sid));
  }

  /** Unsubscribe when the session leaves the queue or disconnects. */
  async unsubscribe(sid: string): Promise<void> {
    this.handlers.delete(sid);
    await this.subscriber.unsubscribe(matchChannel(sid)).catch(() => undefined);
  }

  /** Publish a match notification to the pod that owns the target session. */
  async publish(msg: CrossPodMatchMessage): Promise<void> {
    await this.publisher.publish(matchChannel(msg.targetSid), JSON.stringify(msg));
  }

  private onMessage(channel: string, message: string): void {
    let parsed: CrossPodMatchMessage;
    try {
      parsed = JSON.parse(message) as CrossPodMatchMessage;
    } catch {
      this.logger.warn("pubsub.message.parse_error", { reasonCode: "parse_error" });
      return;
    }

    const sid = parsed.targetSid;
    const handler = this.handlers.get(sid);
    if (!handler) return; // session already gone from this pod

    try {
      handler(parsed);
    } catch (err) {
      this.logger.error("pubsub.handler.error", {
        sessionId: sid,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Graceful shutdown — disconnect the subscriber. */
  async close(): Promise<void> {
    this.subscriber.disconnect();
  }
}
