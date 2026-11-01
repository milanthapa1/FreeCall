import { describe, expect, it } from "vitest";
import { SlidingWindowCounter, TokenBucket } from "../src/rate-limit";

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("TokenBucket", () => {
  it("starts full and drains one token per event", () => {
    const bucket = new TokenBucket(3, 1, clock().now);

    expect(bucket.available).toBe(3);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("refills at the configured rate, not instantly", () => {
    const time = clock();
    const bucket = new TokenBucket(5, 2, time.now);

    for (let i = 0; i < 5; i += 1) bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);

    // 2 tokens/second => 250ms yields half a token, still not enough for one event.
    time.advance(250);
    expect(bucket.tryConsume()).toBe(false);

    time.advance(250);
    expect(bucket.tryConsume()).toBe(true);
  });

  it("never refills above capacity", () => {
    const time = clock();
    const bucket = new TokenBucket(2, 10, time.now);
    time.advance(60_000);
    expect(bucket.available).toBe(2);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("supports weighted costs such as a chat message", () => {
    const bucket = new TokenBucket(10, 1, clock().now);
    expect(bucket.tryConsume(4)).toBe(true);
    expect(bucket.tryConsume(7)).toBe(false);
    expect(bucket.available).toBe(6);
  });

  it("does not refill when the clock moves backwards", () => {
    const time = clock();
    const bucket = new TokenBucket(2, 100, time.now);
    bucket.tryConsume();
    bucket.tryConsume();

    time.advance(-5_000);
    expect(bucket.tryConsume()).toBe(false);
    expect(bucket.available).toBe(0);
  });

  it("rejects nonsensical configuration at construction time", () => {
    expect(() => new TokenBucket(0, 1)).toThrow(/capacity/i);
    expect(() => new TokenBucket(1, 0)).toThrow(/refill/i);
    expect(() => new TokenBucket(1, 1).tryConsume(0)).toThrow(/cost/i);
  });
});

describe("SlidingWindowCounter", () => {
  it("reports true once the limit is reached inside the window", () => {
    const time = clock();
    const counter = new SlidingWindowCounter(3, 1_000, time.now);

    expect(counter.record()).toBe(false);
    expect(counter.record()).toBe(false);
    expect(counter.record()).toBe(true);
    expect(counter.count).toBe(3);
  });

  it("forgets hits that fall outside the trailing window", () => {
    const time = clock();
    const counter = new SlidingWindowCounter(3, 1_000, time.now);

    counter.record();
    time.advance(600);
    counter.record();
    expect(counter.count).toBe(2);

    time.advance(500); // first hit is now 1100ms old and drops out
    expect(counter.count).toBe(1);
    expect(counter.record()).toBe(false);
  });

  it("keeps counting after the limit so a caller can observe the breach size", () => {
    const time = clock();
    const counter = new SlidingWindowCounter(2, 1_000, time.now);

    counter.record();
    counter.record();
    counter.record();
    expect(counter.count).toBe(3);
  });

  it("is empty after the whole window elapses", () => {
    const time = clock();
    const counter = new SlidingWindowCounter(1, 500, time.now);
    counter.record();
    time.advance(501);
    expect(counter.count).toBe(0);
  });

  it("rejects nonsensical configuration at construction time", () => {
    expect(() => new SlidingWindowCounter(0, 1_000)).toThrow(/max/i);
    expect(() => new SlidingWindowCounter(1, 0)).toThrow(/window/i);
  });
});
