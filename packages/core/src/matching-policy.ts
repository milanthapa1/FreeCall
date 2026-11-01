/**
 * Matching policy — server-side preference validation and priority computation.
 *
 * The realtime server derives queue keys from authoritative session data, not raw client
 * preference fields. Client-supplied values are treated as preferences and clamped here
 * (ADR-0006).
 */

import type { AgeTier, TrustBand } from "@freecall/protocol";

export interface EnqueuePreferences {
  /** ISO 3166-1 alpha-2 country code or "any". */
  country: string;
  /** "solo" or "couple". */
  mode: "solo" | "couple";
  /** ISO 639-1 language code (from `Accept-Language` or explicit preference). */
  lang: string;
  /** User's own gender for matching purposes. */
  ownGender?: string;
  /** Whether gender matching must be strict. */
  strictGender?: boolean;
}

export interface MatchingPolicyResult {
  country: string;
  mode: "solo" | "couple";
  lang: string;
  ownGender: string | undefined;
  /** Priority boost in milliseconds (subtracted from queue score). Higher = earlier. */
  priorityBoostMs: number;
}

const ALLOWED_LANGS = new Set([
  "en", "es", "pt", "hi", "ar", "fr", "de", "it", "ja", "ko", "zh", "ru", "tr", "any",
]);

const MAX_PRIORITY_BOOST_MS = 10_000;

/** Compute priority boost from trust band and age tier. */
export function computePriorityBoost(
  trustBand: TrustBand,
  ageTier: AgeTier,
  prevSkipBoostMs = 0,
): number {
  let boost = 0;
  // High-trust users get a small boost to reward good behaviour.
  if (trustBand === "high") boost += 2_000;
  // Higher age assurance earns a slight boost.
  if (ageTier === "t2_verified") boost += 1_000;
  else if (ageTier === "t1_estimated") boost += 500;
  // Re-queue boost (after skip or setup failure).
  boost += Math.min(prevSkipBoostMs, MAX_PRIORITY_BOOST_MS);
  return boost;
}

/**
 * Validate and normalise client enqueue preferences.
 * Rejects or clamps any value that violates server-side policy.
 */
export function applyMatchingPolicy(
  prefs: EnqueuePreferences,
  trustBand: TrustBand,
  ageTier: AgeTier,
  prevSkipBoostMs = 0,
): MatchingPolicyResult {
  // Country: must be a 2-letter code or "any".
  const country =
    typeof prefs.country === "string" &&
    (/^[A-Z]{2}$/i.test(prefs.country) || prefs.country === "any")
      ? prefs.country.toUpperCase() === "ANY"
        ? "any"
        : prefs.country.toUpperCase()
      : "any";

  // Language: clamp to allowed set.
  const lang = ALLOWED_LANGS.has(prefs.lang) ? prefs.lang : "en";

  // Mode: only solo or couple.
  const mode = prefs.mode === "couple" ? "couple" : "solo";

  // Gender: pass through only known values.
  const ownGender =
    prefs.ownGender === "m" || prefs.ownGender === "f" || prefs.ownGender === "x"
      ? prefs.ownGender
      : undefined;

  const priorityBoostMs = computePriorityBoost(trustBand, ageTier, prevSkipBoostMs);

  return { country, mode, lang, ownGender, priorityBoostMs };
}
