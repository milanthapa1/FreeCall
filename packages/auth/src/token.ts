import { importPKCS8, SignJWT } from "jose";
import type { AgeTier, TrustBand } from "@freecall/protocol";
import { randomUUID } from "node:crypto";

export interface MintRealtimeTokenParams {
  userId: string;
  sessionId: string;
  ageTier: AgeTier;
  trustBand: TrustBand;
  market: string;
  region: string;
  entitlements?: string[];
  expiresInSeconds?: number;
}

export interface MintRealtimeTokenOptions {
  secret?: string;
  privateKeyPem?: string;
  algorithm?: string;
  issuer?: string;
  audience?: string;
}

/**
 * Mints a short-lived signed JWT for authenticating realtime WebSocket connections.
 * Matches the validation schema in apps/realtime/src/auth.ts.
 */
export async function mintRealtimeToken(
  params: MintRealtimeTokenParams,
  options: MintRealtimeTokenOptions,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.expiresInSeconds ?? 60;
  const exp = now + ttl;
  const jti = randomUUID();

  const issuer = options.issuer ?? "freecall-auth";
  const audience = options.audience ?? "freecall-realtime";

  let key: Uint8Array | Awaited<ReturnType<typeof importPKCS8>>;
  let algorithm = options.algorithm ?? "HS256";

  if (options.secret !== undefined) {
    key = new TextEncoder().encode(options.secret);
    algorithm = "HS256";
  } else if (options.privateKeyPem !== undefined) {
    key = await importPKCS8(options.privateKeyPem, options.algorithm ?? "EdDSA");
    algorithm = options.algorithm ?? "EdDSA";
  } else {
    throw new Error("Cannot mint token: neither secret nor privateKeyPem was provided");
  }

  return new SignJWT({
    sub: params.userId,
    sid: params.sessionId,
    age_tier: params.ageTier,
    trust_band: params.trustBand,
    market: params.market.toUpperCase(),
    region: params.region,
    ent: params.entitlements ?? [],
  })
    .setProtectedHeader({ alg: algorithm, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
}
