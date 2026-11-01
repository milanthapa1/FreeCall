/**
 * Age assurance provider abstraction.
 *
 * Concrete adapters for Yoti, Persona, and Veriff implement `AgeAssuranceProvider`.
 * The interface is deliberately narrow: the system only needs to know the resulting
 * age band and a provider reference for audit purposes. Raw provider payloads are
 * never stored in Postgres; the SHA-256 of the decision is stored instead.
 */

export type AgeBand =
  | "13_17"    // minor — must never be allowed
  | "18_20"    // young adult
  | "21_24"    // adult
  | "25_34"
  | "35_49"
  | "50_plus"
  | "unknown"; // provider could not determine age

export interface AgeAssuranceResult {
  /** Canonical age band. */
  ageBand: AgeBand;
  /** Provider-assigned reference for audit trail (not a raw payload). */
  providerRef: string;
  /** Whether the result can be trusted enough for `t2_verified`. */
  verified: boolean;
  /** Raw score or confidence [0, 1] if provided. */
  confidence?: number;
}

export type AgeAssuranceOutcome =
  | { ok: true; result: AgeAssuranceResult }
  | { ok: false; reason: "provider_error" | "session_expired" | "user_declined" };

export interface AgeAssuranceProvider {
  /** Provider name (e.g. "yoti", "persona", "veriff"). */
  name: string;

  /**
   * Create a verification session. Returns a redirect URL for the user.
   */
  createSession(opts: {
    userId: string;
    market: string;
    returnUrl: string;
  }): Promise<{ sessionId: string; redirectUrl: string }>;

  /**
   * Complete a verification after the user returns from the provider.
   * Validates the webhook signature and extracts the age decision.
   */
  completeSession(opts: {
    sessionId: string;
    webhookPayload: unknown;
    webhookSignature: string;
  }): Promise<AgeAssuranceOutcome>;

  /** Health check. */
  ping(): Promise<boolean>;
}
