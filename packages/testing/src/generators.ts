/**
 * Property-test generators for freecall domain types.
 *
 * These produce random but valid values for fuzzing and property-based tests.
 * They are NOT suitable for production data — they exist purely for test coverage.
 */

import { randomUUID } from "node:crypto";
import type { AgeTier, Mode, TrustBand } from "@freecall/protocol";

export function randomUserId(): string {
  return randomUUID();
}

export function randomSessionId(): string {
  return randomUUID();
}

export function randomCallId(): string {
  return randomUUID();
}

export function randomMarket(): string {
  const markets = ["US", "GB", "CA", "AU", "DE", "FR", "BR", "JP", "KR", "MX"];
  return markets[Math.floor(Math.random() * markets.length)] ?? "US";
}

export function randomAgeTier(): AgeTier {
  const tiers: AgeTier[] = ["t0_declared", "t1_estimated", "t2_verified"];
  return tiers[Math.floor(Math.random() * tiers.length)] ?? "t0_declared";
}

export function randomTrustBand(): TrustBand {
  const bands: TrustBand[] = ["low", "normal", "high"];
  return bands[Math.floor(Math.random() * bands.length)] ?? "normal";
}

export function randomMode(): Mode {
  return Math.random() > 0.5 ? "solo" : "couple";
}

export function randomLang(): string {
  const langs = ["en", "es", "pt", "hi", "ar", "fr", "de"];
  return langs[Math.floor(Math.random() * langs.length)] ?? "en";
}

export function randomRegion(): string {
  const regions = ["iad", "lax", "fra", "sin", "syd", "gru"];
  return regions[Math.floor(Math.random() * regions.length)] ?? "iad";
}

export function randomChatMessage(maxLen = 200): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz ";
  const len = Math.floor(Math.random() * maxLen) + 1;
  return Array.from({ length: len }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export interface FakeUserOpts {
  userId?: string;
  market?: string;
  ageTier?: AgeTier;
  trustBand?: TrustBand;
}

export function fakeUser(opts: FakeUserOpts = {}) {
  return {
    id: opts.userId ?? randomUserId(),
    market: opts.market ?? randomMarket(),
    ageTier: opts.ageTier ?? randomAgeTier(),
    trustBand: opts.trustBand ?? randomTrustBand(),
    isAnonymous: true,
  };
}
