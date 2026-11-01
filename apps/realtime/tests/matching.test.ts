import { describe, expect, it } from "vitest";
import {
  TRUST_BAND_NUM,
  WIDENING_STEPS,
  banKey,
  claimKey,
  exclusionKey,
  guestCapKey,
  parseEntry,
  presenceKey,
  queueKeys,
  serializeEntry,
  type QueueEntry,
} from "../src/matching/queue.js";

describe("Matchmaking Queue Helpers", () => {
  it("generates correct Redis keys", () => {
    const keys = queueKeys("iad", "en", "solo");
    expect(keys.q).toBe("mm:{iad}:en:solo:q");
    expect(keys.m).toBe("mm:{iad}:en:solo:m");

    expect(exclusionKey("iad", "sid-123")).toBe("mm:{iad}:ex:sid-123");
    expect(claimKey("iad", "sid-123")).toBe("mm:{iad}:claim:sid-123");
    expect(presenceKey("sid-123")).toBe("presence:sid-123");
    expect(banKey("user-123")).toBe("ban:user-123");
    expect(guestCapKey("user-123", "2026-10-30")).toBe("cap:user-123:2026-10-30");
  });

  it("serializes and parses QueueEntry round-trip", () => {
    const entry: QueueEntry = {
      c: "US",
      l: "en",
      b: TRUST_BAND_NUM["high"] ?? 2,
      t: "t1_estimated",
      g: "m",
      p: 5000,
    };

    const raw = serializeEntry(entry);
    const parsed = parseEntry(raw);

    expect(parsed.c).toBe("US");
    expect(parsed.l).toBe("en");
    expect(parsed.b).toBe(2);
    expect(parsed.t).toBe("t1_estimated");
    expect(parsed.g).toBe("m");
    expect(parsed.p).toBe(5000);
  });

  it("enforces trust band numeric mapping", () => {
    expect(TRUST_BAND_NUM["low"]).toBe(0);
    expect(TRUST_BAND_NUM["normal"]).toBe(1);
    expect(TRUST_BAND_NUM["high"]).toBe(2);

    // Band gap check: low (0) and high (2) delta is 2 > 1 (hard reject)
    const lowToHighDelta = Math.abs((TRUST_BAND_NUM["low"] ?? 0) - (TRUST_BAND_NUM["high"] ?? 2));
    expect(lowToHighDelta).toBe(2);
    expect(lowToHighDelta > 1).toBe(true);

    // Normal (1) with low (0) or high (2) delta is 1 <= 1 (allowed)
    const normalToLowDelta = Math.abs((TRUST_BAND_NUM["normal"] ?? 1) - (TRUST_BAND_NUM["low"] ?? 0));
    expect(normalToLowDelta).toBe(1);
    expect(normalToLowDelta <= 1).toBe(true);
  });

  it("builds correct widening schedule keys", () => {
    expect(WIDENING_STEPS).toHaveLength(4);

    // Step 0: exact
    const step0Keys = WIDENING_STEPS[0]!.buildKeys({
      region: "iad",
      lang: "es",
      mode: "solo",
    });
    expect(step0Keys).toEqual(["mm:{iad}:es:solo:q"]);

    // Step 1: relax language
    const step1Keys = WIDENING_STEPS[1]!.buildKeys({
      region: "iad",
      lang: "es",
      mode: "solo",
    });
    expect(step1Keys).toContain("mm:{iad}:es:solo:q");
    expect(step1Keys).toContain("mm:{iad}:en:solo:q");
    expect(step1Keys).toContain("mm:{iad}:any:solo:q");

    // Step 2: relax region
    const step2Keys = WIDENING_STEPS[2]!.buildKeys({
      region: "iad",
      lang: "en",
      mode: "solo",
      neighbourRegions: ["fra"],
    });
    expect(step2Keys).toContain("mm:{iad}:en:solo:q");
    expect(step2Keys).toContain("mm:{fra}:en:solo:q");

    // Step 3: relax mode
    const step3Keys = WIDENING_STEPS[3]!.buildKeys({
      region: "iad",
      lang: "en",
      mode: "solo",
    });
    expect(step3Keys).toContain("mm:{iad}:en:solo:q");
    expect(step3Keys).toContain("mm:{iad}:en:couple:q");
  });
});
