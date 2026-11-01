import { loadRealtimeEnv, type RealtimeEnv } from "@freecall/config";
import type { AgeTier, TrustBand } from "@freecall/protocol";
import {
  SignJWT,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  type CryptoKey,
} from "jose";
import { describe, expect, it } from "vitest";
import { AuthError, createTokenVerifier, type VerifiedIdentity } from "../src/auth";

const baseEnv = {
  NODE_ENV: "test",
  REGION: "iad",
  REDIS_URL: "redis://localhost:6379",
  LIVEKIT_API_URL: "http://localhost:7880",
  LIVEKIT_API_KEY: "devkey12",
  LIVEKIT_API_SECRET: "a3f1c9e7b5d24860a3f1c9e7b5d24860",
  JWT_DEV_SECRET: "c4e2a1b8d6f34970c4e2a1b8d6f34970",
} as const;

const USER_ID = "0190f5a0-0000-7000-8000-000000000001";
const SESSION_ID = "0190f5a0-0000-7000-8000-000000000002";

function env(overrides: Record<string, string | undefined> = {}): RealtimeEnv {
  return loadRealtimeEnv({ ...baseEnv, ...overrides });
}

interface Claims {
  sub?: string;
  sid?: string;
  jti?: string;
  region?: string;
  market?: string;
  age_tier?: AgeTier;
  trust_band?: TrustBand;
  ent?: string[];
  iat?: number;
  exp?: number;
  audience?: string;
  issuer?: string;
}

async function signToken(
  config: RealtimeEnv,
  claims: Claims = {},
  key: CryptoKey | Uint8Array = new TextEncoder().encode(config.JWT_DEV_SECRET ?? ""),
  algorithm = "HS256",
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sid: claims.sid ?? SESSION_ID,
    jti: claims.jti ?? "token-1",
    age_tier: claims.age_tier ?? "t2_verified",
    trust_band: claims.trust_band ?? "normal",
    market: claims.market ?? "US",
    region: claims.region ?? config.REGION,
    ent: claims.ent ?? ["chat", "video"],
  })
    .setProtectedHeader({ alg: algorithm })
    .setSubject(claims.sub ?? USER_ID)
    .setIssuer(claims.issuer ?? config.JWT_ISSUER)
    .setAudience(claims.audience ?? config.JWT_AUDIENCE)
    .setIssuedAt(claims.iat ?? now)
    .setExpirationTime(claims.exp ?? now + 60)
    .sign(key);
}

async function expectAuthError(promise: Promise<VerifiedIdentity>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "AuthError", code });
}

describe("createTokenVerifier (HS256 development mode)", () => {
  it("accepts a valid token and maps claims to the internal identity", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    const identity = await verifier.verify(await signToken(config));

    expect(identity).toMatchObject({
      userId: USER_ID,
      sessionId: SESSION_ID,
      jti: "token-1",
      ageTier: "t2_verified",
      trustBand: "normal",
      market: "US",
      region: "iad",
      entitlements: ["chat", "video"],
    });
  });

  it("rejects an expired token", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    const now = Math.floor(Date.now() / 1000);
    await expectAuthError(
      verifier.verify(await signToken(config, { iat: now - 120, exp: now - 60 })),
      "expired",
    );
  });

  it("rejects a token for another audience", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    await expectAuthError(
      verifier.verify(await signToken(config, { audience: "mobile" })),
      "wrong_audience",
    );
  });

  it("rejects a token from another issuer", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    await expectAuthError(
      verifier.verify(await signToken(config, { issuer: "someone-else" })),
      "wrong_issuer",
    );
  });

  it("rejects a token minted for another region", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    await expectAuthError(
      verifier.verify(await signToken(config, { region: "fra" })),
      "wrong_region",
    );
  });

  it("rejects a token signed with the wrong secret", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    const wrongKey = new TextEncoder().encode("d9b7c5a3e1f04820d9b7c5a3e1f04820");
    await expectAuthError(verifier.verify(await signToken(config, {}, wrongKey)), "bad_signature");
  });

  it("rejects a token with a missing required claim", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    const now = Math.floor(Date.now() / 1000);
    // `market` and `sid` are deliberately absent: the signature is valid, but the payload
    // does not describe an identity this service is allowed to accept.
    const token = await new SignJWT({
      jti: "token-1",
      age_tier: "t2_verified",
      trust_band: "normal",
      region: "iad",
      ent: [],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer(config.JWT_ISSUER)
      .setAudience(config.JWT_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(config.JWT_DEV_SECRET ?? ""));

    await expectAuthError(verifier.verify(token), "invalid_claims");
  });

  it("rejects a token whose market is not an ISO alpha-2 code", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    await expectAuthError(verifier.verify(await signToken(config, { market: "us" })), "invalid_claims");
  });

  it("rejects a token lifetime longer than the connect window", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);
    const now = Math.floor(Date.now() / 1000);
    await expectAuthError(
      verifier.verify(await signToken(config, { iat: now, exp: now + 3_600 })),
      "invalid_claims",
    );
  });

  it("rejects malformed, empty and oversized tokens without leaking them", async () => {
    const config = env();
    const verifier = await createTokenVerifier(config);

    await expectAuthError(verifier.verify("not-a-token"), "malformed_token");
    await expectAuthError(verifier.verify("x".repeat(5_000)), "malformed_token");

    try {
      await verifier.verify("not-a-token");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as Error).message).not.toContain("not-a-token");
    }
  });
});

describe("createTokenVerifier (asymmetric production mode)", () => {
  it("verifies an EdDSA token with a static SPKI public key", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
    const spki = await exportSPKI(publicKey);
    const pkcs8 = await exportPKCS8(privateKey);

    const config = env({
      JWT_DEV_SECRET: undefined,
      JWT_ALGORITHM: "EdDSA",
      JWT_PUBLIC_KEY: spki,
    });

    const verifier = await createTokenVerifier(config);
    const { importPKCS8 } = await import("jose");
    const signingKey = await importPKCS8(pkcs8, "EdDSA");
    const identity = await verifier.verify(await signToken(config, {}, signingKey, "EdDSA"));

    expect(identity.userId).toBe(USER_ID);
  });

  it("accepts a PEM key with escaped newlines, as stored by some secret managers", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
    const spki = (await exportSPKI(publicKey)).replace(/\n/g, "\\n");
    const pkcs8 = await exportPKCS8(privateKey);

    const config = env({
      JWT_DEV_SECRET: undefined,
      JWT_ALGORITHM: "EdDSA",
      JWT_PUBLIC_KEY: spki,
    });

    const verifier = await createTokenVerifier(config);
    const { importPKCS8 } = await import("jose");
    const signingKey = await importPKCS8(pkcs8, "EdDSA");
    await expect(
      verifier.verify(await signToken(config, {}, signingKey, "EdDSA")),
    ).resolves.toMatchObject({ userId: USER_ID });
  });

  it("refuses to start with a PEM that does not contain a public key", async () => {
    const config = env({
      JWT_DEV_SECRET: undefined,
      JWT_ALGORITHM: "EdDSA",
      JWT_PUBLIC_KEY: "not-a-pem",
    });
    await expect(createTokenVerifier(config)).rejects.toBeInstanceOf(AuthError);
  });
});
