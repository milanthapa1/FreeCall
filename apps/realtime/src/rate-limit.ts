/**
 * Per-socket rate limiting. A token bucket (not a fixed window) is used because fixed
 * windows let a client send a full burst at the end of one window and another at the start
 * of the next, which is exactly the pattern abusive clients use.
 *
 * The clock is injectable so tests are deterministic without fake timers.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefillAt: number;

  constructor(capacity: number, refillPerSecond: number, now: () => number = Date.now) {
    if (capacity <= 0) throw new Error("TokenBucket capacity must be positive");
    if (refillPerSecond <= 0) throw new Error("TokenBucket refill rate must be positive");

    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.tokens = capacity;
    this.lastRefillAt = now();
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }

  tryConsume(cost = 1): boolean {
    if (cost <= 0) throw new Error("TokenBucket cost must be positive");
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  private refill(): void {
    const current = this.now();
    const elapsedSeconds = Math.max(0, (current - this.lastRefillAt) / 1_000);
    if (elapsedSeconds === 0) return;

    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillAt = current;
  }
}

/**
 * Counts events in a trailing window. Used for "five invalid frames in sixty seconds closes
 * the socket": a counter that decays, rather than a permanent strike count that punishes a
 * client that reconnected after a bad deploy.
 */
export class SlidingWindowCounter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private hits: number[] = [];

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    if (max <= 0) throw new Error("SlidingWindowCounter max must be positive");
    if (windowMs <= 0) throw new Error("SlidingWindowCounter window must be positive");
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Records a hit and returns true when the limit has been reached. */
  record(): boolean {
    const current = this.now();
    const cutoff = current - this.windowMs;
    this.hits = this.hits.filter((hit) => hit > cutoff);
    this.hits.push(current);
    return this.hits.length >= this.max;
  }

  get count(): number {
    const cutoff = this.now() - this.windowMs;
    this.hits = this.hits.filter((hit) => hit > cutoff);
    return this.hits.length;
  }
}
