import type { RealtimeEnv } from "@freecall/config";
import type { AgeTier, TrustBand } from "@freecall/protocol";
import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";

/**
 * Realtime authentication verifies a short-lived token minted by the web tier. There is no
 * database round trip on connect: the token carries the identity, age tier, trust band and
 * market that the policy engine already resolved.
 *
 * Production uses an asymmetric key (static SPKI or JWKS) so a compromised realtime pod
 * cannot mint tokens. HS256 exists only for local development and tests, and the env schema
 * refuses to boot with a dev secret in production.
 */

export interface VerifiedIdentity {
  userId: string;
  sessionId: string;
  /** Unique token id, used for replay detection before the connection is accepted. */
  jti: string;
  ageTier: AgeTier;
  trustBand: TrustBand;
  market: string;
  region: string;
  entitlements: readonly string[];
  issuedAt: number;
  expiresAt: number;
}

export type AuthFailureCode =
  | "malformed_token"
  | "bad_signature"
  | "expired"
  | "wrong_audience"
  | "wrong_issuer"
  | "wrong_region"
  | "invalid_claims"
  | "jwks_unavailable";

export class AuthError extends Error {
  readonly code: AuthFailureCode;

  constructor(code: AuthFailureCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

const claimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  jti: z.string().min(1).max(128),
  age_tier: z.enum(["t0_declared", "t1_estimated", "t2_verified", "t3_locked"]),
  trust_band: z.enum(["low", "normal", "high"]),
  market: z.string().regex(/^[A-Z]{2}$/, "must be an ISO 3166-1 alpha-2 code"),
  region: z.string().min(2).max(8),
  ent: z.array(z.string().min(1).max(64)).max(32).default([]),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

/** A token is issued for one connect attempt; five minutes is already generous. */
const MAX_TOKEN_LIFETIME_SECONDS = 300;
const CLOCK_TOLERANCE_SECONDS = 10;

type KeyMaterial = Awaited<ReturnType<typeof importSPKI>> | Uint8Array | ReturnType<typeof createRemoteJWKSet>;

export async function createTokenVerifier(env: RealtimeEnv): Promise<TokenVerifier> {
  const devSecret = env.JWT_DEV_SECRET;
  const algorithm = devSecret !== undefined ? "HS256" : env.JWT_ALGORITHM;

  let key: KeyMaterial;
  if (devSecret !== undefined) {
    key = new TextEncoder().encode(devSecret);
  } else if (env.JWT_PUBLIC_KEY !== undefined) {
    try {
      key = await importSPKI(normalizePem(env.JWT_PUBLIC_KEY), algorithm);
    } catch {
      throw new AuthError(
        "invalid_claims",
        "JWT_PUBLIC_KEY could not be imported as an SPKI public key for the configured algorithm",
      );
    }
  } else if (env.JWKS_URL !== undefined) {
    key = createRemoteJWKSet(new URL(env.JWKS_URL), {
      timeoutDuration: 3_000,
      cooldownDuration: 30_000,
    });
  } else {
    throw new AuthError(
      "invalid_claims",
      "no JWT verification key is configured; set JWT_PUBLIC_KEY, JWKS_URL or JWT_DEV_SECRET",
    );
  }

  return {
    async verify(token: string): Promise<VerifiedIdentity> {
      if (typeof token !== "string" || token.length < 20 || token.length > 4_096) {
        throw new AuthError("malformed_token", "token is missing or has an invalid length");
      }

      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, key, {
          algorithms: [algorithm],
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          requiredClaims: ["exp", "iat", "jti"],
        });
        payload = result.payload;
      } catch (error) {
        throw mapJoseError(error);
      }

      const parsed = claimsSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AuthError("invalid_claims", "token claims failed validation");
      }

      const claims = parsed.data;
      if (claims.region !== env.REGION) {
        throw new AuthError(
          "wrong_region",
          "token was issued for a different realtime region; reconnect to the region in the token",
        );
      }
      if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) {
        throw new AuthError("invalid_claims", "token lifetime exceeds the maximum for a connect token");
      }

      return {
        userId: claims.sub,
        sessionId: claims.sid,
        jti: claims.jti,
        ageTier: claims.age_tier,
        trustBand: claims.trust_band,
        market: claims.market,
        region: claims.region,
        entitlements: claims.ent,
        issuedAt: claims.iat,
        expiresAt: claims.exp,
      };
    },
  };
}

function normalizePem(value: string): string {
  return value.includes("\\n") && !value.includes("\n") ? value.replace(/\\n/g, "\n") : value;
}

function mapJoseError(error: unknown): AuthError {
  const code = readStringProperty(error, "code");
  const claim = readStringProperty(error, "claim");

  switch (code) {
    case "ERR_JWT_EXPIRED":
      return new AuthError("expired", "token has expired");
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      if (claim === "aud") {
        return new AuthError("wrong_audience", "token audience does not match this service");
      }
      if (claim === "iss") {
        return new AuthError("wrong_issuer", "token issuer does not match this service");
      }
      return new AuthError("invalid_claims", "token claims failed validation");
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JOSE_ALG_NOT_ALLOWED":
      return new AuthError("bad_signature", "token signature is not valid for this service");
    case "ERR_JWKS_TIMEOUT":
      return new AuthError("jwks_unavailable", "key set could not be retrieved in time");
    case "ERR_JWT_INVALID":
    case "ERR_JWS_INVALID":
    case "ERR_JOSE_NOT_SUPPORTED":
      return new AuthError("malformed_token", "token is not a valid signed JWT");
    default:
      return new AuthError("malformed_token", "token could not be verified");
  }
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}
