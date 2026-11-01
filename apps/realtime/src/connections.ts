/**
 * Connection accounting, independent of the WebSocket library so it can be unit tested
 * without sockets.
 *
 * Two caps matter for a public video product:
 * - per-IP, because a single attacker should not consume an entire pod's socket budget;
 * - per-pod, because overload must be refused at accept time rather than discovered when
 *   the event loop is already saturated.
 *
 * The registry also enforces one live connection per user: a second connection replaces the
 * first (close 4004) instead of silently doubling a user's event budget.
 */

export interface CloseableConnection {
  close(code: number, reason: string): void;
}

export type AcquireResult = "ok" | "ip_cap" | "pod_cap";

export class ConnectionRegistry {
  private readonly maxTotal: number;
  private readonly maxPerIp: number;
  private readonly perIp = new Map<string, number>();
  private readonly byUser = new Map<string, CloseableConnection>();
  private readonly bySession = new Map<string, CloseableConnection>();
  private total = 0;

  constructor(maxTotal: number, maxPerIp: number) {
    if (maxTotal <= 0) throw new Error("maxTotal must be positive");
    if (maxPerIp <= 0) throw new Error("maxPerIp must be positive");
    this.maxTotal = maxTotal;
    this.maxPerIp = maxPerIp;
  }

  get size(): number {
    return this.total;
  }

  connectionsFor(ip: string): number {
    return this.perIp.get(ip) ?? 0;
  }

  acquire(ip: string): AcquireResult {
    if (this.total >= this.maxTotal) return "pod_cap";

    const current = this.perIp.get(ip) ?? 0;
    if (current >= this.maxPerIp) return "ip_cap";

    this.total += 1;
    this.perIp.set(ip, current + 1);
    return "ok";
  }

  release(ip: string): void {
    const current = this.perIp.get(ip);
    if (current === undefined || current <= 0) return;

    if (this.total > 0) this.total -= 1;
    if (current <= 1) {
      this.perIp.delete(ip);
    } else {
      this.perIp.set(ip, current - 1);
    }
  }

  /** Binds a verified user to a connection and returns the connection it replaced. */
  bindUser(userId: string, connection: CloseableConnection): CloseableConnection | undefined {
    const previous = this.byUser.get(userId);
    this.byUser.set(userId, connection);
    return previous === connection ? undefined : previous;
  }

  /** Only removes the binding if it still points at this connection. */
  unbindUser(userId: string, connection: CloseableConnection): void {
    if (this.byUser.get(userId) === connection) {
      this.byUser.delete(userId);
    }
  }

  userConnection(userId: string): CloseableConnection | undefined {
    return this.byUser.get(userId);
  }

  /**
   * Look up a connection by userId.
   * Used by SocketSession to relay events to the peer in a matched call.
   */
  getByUserId(userId: string): CloseableConnection | undefined {
    return this.byUser.get(userId);
  }

  /**
   * Look up a connection by sessionId (mapped separately from userId).
   * A session maps one userId → connection. Session id is stored in a parallel map.
   */
  getBySessionId(sessionId: string): CloseableConnection | undefined {
    return this.bySession.get(sessionId);
  }

  /** Bind a session id alongside the user id. */
  bindSession(sessionId: string, connection: CloseableConnection): void {
    this.bySession.set(sessionId, connection);
  }

  /** Remove a session binding. */
  unbindSession(sessionId: string, connection: CloseableConnection): void {
    if (this.bySession.get(sessionId) === connection) {
      this.bySession.delete(sessionId);
    }
  }
}

/** `::ffff:127.0.0.1` and `127.0.0.1` are the same client; cap them together. */
export function normalizeIp(remoteAddress: string | undefined): string {
  if (remoteAddress === undefined || remoteAddress.length === 0) return "unknown";
  return remoteAddress.startsWith("::ffff:") ? remoteAddress.slice(7) : remoteAddress;
}

/**
 * Extracts the client address from a request.
 *
 * Forwarded headers are attacker-controlled unless a trusted proxy overwrote them, so they
 * are only consulted when `trustProxy` is enabled by configuration. The right-most entry is
 * used: that is the hop appended by our own load balancer.
 */
export function clientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustProxy: boolean,
): string {
  if (!trustProxy) return normalizeIp(remoteAddress);

  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  if (raw === undefined || raw.trim() === "") return normalizeIp(remoteAddress);

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const last = parts.at(-1);
  return normalizeIp(last ?? remoteAddress);
}

/**
 * Browser WebSockets always send `Origin`; native clients usually do not. A missing origin
 * is therefore accepted (authentication still applies), but an origin that is present and
 * not on the allowlist is rejected, which is what prevents cross-site socket hijacking.
 */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined || origin.length === 0) return true;
  if (origin === "null") return false;
  return allowed.includes(origin.replace(/\/$/, ""));
}
