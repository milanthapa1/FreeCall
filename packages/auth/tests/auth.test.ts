import { describe, expect, it } from "vitest";
import { jwtVerify } from "jose";
import {
  calculateAge,
  evaluateAgeGate,
  getGuestCapabilities,
  hashFingerprint,
  hashToken,
  isAdult,
  isAgeTierSatisfied,
  isGuestCapExceeded,
  mintRealtimeToken,
} from "../src/index.js";
import type { MarketDecision } from "@freecall/db";

describe("@freecall/auth", () => {
  describe("age gate logic", () => {
    it("enforces tier hierarchy correctly", () => {
      expect(isAgeTierSatisfied("t0_declared", "t0_declared")).toBe(true);
      expect(isAgeTierSatisfied("t0_declared", "t1_estimated")).toBe(false);
      expect(isAgeTierSatisfied("t0_declared", "t2_verified")).toBe(false);

      expect(isAgeTierSatisfied("t1_estimated", "t0_declared")).toBe(true);
      expect(isAgeTierSatisfied("t1_estimated", "t1_estimated")).toBe(true);
      expect(isAgeTierSatisfied("t1_estimated", "t2_verified")).toBe(false);

      expect(isAgeTierSatisfied("t2_verified", "t0_declared")).toBe(true);
      expect(isAgeTierSatisfied("t2_verified", "t1_estimated")).toBe(true);
      expect(isAgeTierSatisfied("t2_verified", "t2_verified")).toBe(true);

      expect(isAgeTierSatisfied("t3_locked", "t0_declared")).toBe(false);
      expect(isAgeTierSatisfied("t3_locked", "t1_estimated")).toBe(false);
      expect(isAgeTierSatisfied("t3_locked", "t2_verified")).toBe(false);
    });

    it("evaluates chronological age and adult boundary accurately", () => {
      const refDate = new Date("2026-10-30T12:00:00Z");

      // Exactly 18 years old today
      const exact18 = new Date("2008-10-30T00:00:00Z");
      expect(calculateAge(exact18, refDate)).toBe(18);
      expect(isAdult(exact18, refDate)).toBe(true);

      // Turns 18 tomorrow (currently 17)
      const turns18Tomorrow = new Date("2008-10-31T00:00:00Z");
      expect(calculateAge(turns18Tomorrow, refDate)).toBe(17);
      expect(isAdult(turns18Tomorrow, refDate)).toBe(false);

      // 25 years old
      const age25 = new Date("2001-05-15T00:00:00Z");
      expect(calculateAge(age25, refDate)).toBe(25);
      expect(isAdult(age25, refDate)).toBe(true);
    });

    it("evaluates market age gate decisions", () => {
      const baseDecision: MarketDecision = {
        market: "US",
        serviceClass: "full",
        enabled: true,
        matchingEnabled: true,
        monetizationEnabled: true,
        requiredAgeTier: "t0_declared",
        guestMinutesPerDay: 30,
        residency: "global",
        retentionDays: 90,
        reportingAuthority: "ncmec",
        policyVersion: 1,
        reasons: [],
      };

      // Allowed when market requires t0 and user has t0
      const allowed = evaluateAgeGate("t0_declared", baseDecision);
      expect(allowed.allowed).toBe(true);

      // Blocked when market requires t1 (e.g. strict market) and user only has t0
      const strictDecision: MarketDecision = {
        ...baseDecision,
        requiredAgeTier: "t1_estimated",
      };
      const needsAssurance = evaluateAgeGate("t0_declared", strictDecision);
      expect(needsAssurance.allowed).toBe(false);
      expect(needsAssurance.reason).toBe("age_assurance_required");

      // Locked accounts are unconditionally denied
      const locked = evaluateAgeGate("t3_locked", baseDecision);
      expect(locked.allowed).toBe(false);
      expect(locked.reason).toBe("account_locked");

      // Disabled markets are denied
      const disabledMarket: MarketDecision = {
        ...baseDecision,
        enabled: false,
        matchingEnabled: false,
      };
      const marketBlocked = evaluateAgeGate("t2_verified", disabledMarket);
      expect(marketBlocked.allowed).toBe(false);
      expect(marketBlocked.reason).toBe("market_blocked");
    });
  });

  describe("guest limits & capabilities", () => {
    it("caps self-declared guests at 30 minutes/day and restricts elevated features", () => {
      const guestCaps = getGuestCapabilities("t0_declared", 30);
      expect(guestCaps.canDm).toBe(false);
      expect(guestCaps.canUpload).toBe(false);
      expect(guestCaps.canEditProfile).toBe(false);
      expect(guestCaps.maxDailyMinutes).toBe(30);
      expect(guestCaps.elevatedSampling).toBe(true);

      expect(isGuestCapExceeded(25, guestCaps.maxDailyMinutes)).toBe(false);
      expect(isGuestCapExceeded(30, guestCaps.maxDailyMinutes)).toBe(true);
      expect(isGuestCapExceeded(35, guestCaps.maxDailyMinutes)).toBe(true);
    });

    it("grants full capabilities to verified tiers without minute caps", () => {
      const verifiedCaps = getGuestCapabilities("t1_estimated", 30);
      expect(verifiedCaps.canDm).toBe(true);
      expect(verifiedCaps.canUpload).toBe(true);
      expect(verifiedCaps.maxDailyMinutes).toBe(Infinity);
      expect(verifiedCaps.elevatedSampling).toBe(false);

      expect(isGuestCapExceeded(120, verifiedCaps.maxDailyMinutes)).toBe(false);
    });
  });

  describe("crypto helpers", () => {
    it("computes deterministic SHA-256 hashes", () => {
      const hash1 = hashToken("sample-session-token");
      const hash2 = hashToken("sample-session-token");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);

      const fpHash = hashFingerprint("device-fingerprint-xyz");
      expect(fpHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("realtime token minting", () => {
    it("mints a valid JWT verifiable by jose with exact claims", async () => {
      const secret = "a_very_secret_key_that_is_at_least_32_characters_long!";
      const token = await mintRealtimeToken(
        {
          userId: "018f6f60-9bf7-7599-808a-df9c1db109bb",
          sessionId: "018f6f60-9bf7-7599-808a-df9c1db109bc",
          ageTier: "t0_declared",
          trustBand: "normal",
          market: "US",
          region: "iad",
          entitlements: ["chat:send", "video:call"],
          expiresInSeconds: 120,
        },
        {
          secret,
          issuer: "freecall-test",
          audience: "realtime-test",
        },
      );

      expect(typeof token).toBe("string");

      const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer: "freecall-test",
        audience: "realtime-test",
      });

      expect(verified.payload.sub).toBe("018f6f60-9bf7-7599-808a-df9c1db109bb");
      expect(verified.payload["sid"]).toBe("018f6f60-9bf7-7599-808a-df9c1db109bc");
      expect(verified.payload["age_tier"]).toBe("t0_declared");
      expect(verified.payload["trust_band"]).toBe("normal");
      expect(verified.payload["market"]).toBe("US");
      expect(verified.payload["region"]).toBe("iad");
      expect(verified.payload["ent"]).toEqual(["chat:send", "video:call"]);
    });
  });
});
