import { describe, expect, it } from "vitest";
import { isUuidV7, uuidv7, uuidv7Compact, uuidv7Timestamp } from "../src/id";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("emits RFC 9562 version and variant nibbles", () => {
    for (let i = 0; i < 100; i += 1) {
      const value = uuidv7();
      expect(value).toMatch(UUID_V7);
      expect(value[14]).toBe("7");
      expect("89ab").toContain(value[19]);
    }
  });

  it("is unique and strictly increasing within the same millisecond", () => {
    const fixed = Date.now();
    const values = Array.from({ length: 5_000 }, () => uuidv7(fixed));
    expect(new Set(values).size).toBe(values.length);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]! > values[i - 1]!).toBe(true);
    }
  });

  it("round-trips the embedded millisecond timestamp", () => {
    const before = Date.now();
    const parsed = uuidv7Timestamp(uuidv7());
    const after = Date.now();
    expect(parsed).not.toBeNull();
    // The counter may carry into the next millisecond to preserve monotonicity.
    expect(parsed!.getTime()).toBeGreaterThanOrEqual(before);
    expect(parsed!.getTime()).toBeLessThanOrEqual(after + 2);
  });

  it("stays monotonic when the system clock moves backwards", () => {
    const now = Date.now();
    const first = uuidv7(now);
    const second = uuidv7(now - 60_000);
    const third = uuidv7(now - 60_000);
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
    expect(uuidv7Timestamp(second)!.getTime()).toBeGreaterThanOrEqual(
      uuidv7Timestamp(first)!.getTime(),
    );
  });

  it("rejects impossible timestamps instead of emitting a corrupt id", () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(Number.NaN)).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
  });

  it("compact form drops dashes but keeps a valid timestamp", () => {
    const before = Date.now();
    const compact = uuidv7Compact();
    const after = Date.now();
    expect(compact).toMatch(/^[0-9a-f]{32}$/);
    const timestamp = Number.parseInt(compact.slice(0, 12), 16);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after + 2);
  });

  it("does not confuse v4 uuids with v7 uuids", () => {
    expect(isUuidV7("9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5061")).toBe(false);
    expect(isUuidV7(uuidv7())).toBe(true);
  });
});
