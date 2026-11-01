/**
 * Deterministic fake clock for tests.
 *
 * Usage:
 *   const clock = new FakeClock(1_700_000_000_000);
 *   clock.advance(5_000); // advance by 5 seconds
 *   const now = clock.now(); // 1_700_000_005_000
 */

export class FakeClock {
  private ms: number;

  constructor(startMs: number = 0) {
    this.ms = startMs;
  }

  now(): number {
    return this.ms;
  }

  /** Advance the clock by the given number of milliseconds. */
  advance(ms: number): this {
    this.ms += ms;
    return this;
  }

  /** Set the clock to an absolute timestamp. */
  set(ms: number): this {
    this.ms = ms;
    return this;
  }

  /** Return a function compatible with `deps.now` injection points. */
  fn(): () => number {
    return () => this.ms;
  }
}
