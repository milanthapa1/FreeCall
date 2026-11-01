/**
 * Mock age assurance provider for local dev and tests.
 *
 * Always returns `18_20` verified=true so the product can run without real credentials.
 */

import { randomUUID } from "node:crypto";
import type { AgeAssuranceProvider, AgeAssuranceOutcome } from "./age-assurance.js";

export class MockAgeAssuranceProvider implements AgeAssuranceProvider {
  readonly name = "mock";

  async createSession(opts: {
    userId: string;
    market: string;
    returnUrl: string;
  }): Promise<{ sessionId: string; redirectUrl: string }> {
    const sessionId = randomUUID();
    // In dev mode, redirect immediately back with a fake session param.
    const returnUrl = new URL(opts.returnUrl);
    returnUrl.searchParams.set("age_session_id", sessionId);
    returnUrl.searchParams.set("mock", "1");
    return { sessionId, redirectUrl: returnUrl.toString() };
  }

  async completeSession(opts: {
    sessionId: string;
    webhookPayload: unknown;
    webhookSignature: string;
  }): Promise<AgeAssuranceOutcome> {
    return {
      ok: true,
      result: {
        ageBand: "18_20",
        providerRef: opts.sessionId,
        verified: true,
        confidence: 0.95,
      },
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
