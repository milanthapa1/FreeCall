/**
 * OAuth 2.0 helper utilities.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import {
  createDb,
  users,
  sessions,
  profiles,
  eq,
  uuidv7,
} from "@freecall/db";
import { mintRealtimeToken } from "@freecall/auth";
import { getWebEnv } from "./server-env";
import { getResolvedMarket } from "./geo";
import type { NextRequest } from "next/server";

// ── PKCE ─────────────────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ── State cookies ─────────────────────────────────────────────────────────────

const STATE_COOKIE = "fc_oauth_state";
const VERIFIER_COOKIE = "fc_oauth_verifier";
const COOKIE_MAX_AGE = 600;

export async function writeOAuthCookies(state: string, verifier: string) {
  const jar = await cookies();
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env["NODE_ENV"] === "production",
  };
  jar.set(STATE_COOKIE, state, base);
  jar.set(VERIFIER_COOKIE, verifier, base);
}

export async function consumeOAuthCookies(): Promise<{
  state: string;
  verifier: string;
} | null> {
  const jar = await cookies();
  const state = jar.get(STATE_COOKIE)?.value;
  const verifier = jar.get(VERIFIER_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);
  if (!state || !verifier) return null;
  return { state, verifier };
}

// ── User upsert ───────────────────────────────────────────────────────────────

export interface OAuthProfile {
  provider: "google";
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** Google profile picture URL. */
  picture: string | null;
}

export interface OAuthSessionResult {
  userId: string;
  sessionId: string;
  realtimeToken: string;
  isNewUser: boolean;
}

export async function upsertOAuthUser(
  profile: OAuthProfile,
  request: NextRequest,
): Promise<OAuthSessionResult> {
  const env = getWebEnv();
  const { marketCode } = await getResolvedMarket(request.headers);

  const { db, close } = createDb(env.DATABASE_URL, {
    max: 2,
    connectTimeoutSeconds: 5,
    applicationName: "freecall-web-oauth",
  });

  try {
    const now = new Date();
    let userId: string | null = null;
    let isNewUser = false;

    // Look up existing user by verified email.
    if (profile.email && profile.emailVerified) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, profile.email))
        .limit(1);
      userId = existing[0]?.id ?? null;
    }

    if (!userId) {
      // New user — insert user + profile rows.
      userId = uuidv7();
      isNewUser = true;

      await db.insert(users).values({
        id: userId,
        email: profile.email ?? undefined,
        emailVerifiedAt: profile.emailVerified ? now : null,
        isAnonymous: false,
        market: marketCode,
        ageTier: "t1_estimated",
        lastSeenAt: now,
      });

      // Create profile row with Google name + avatar URL.
      await db.insert(profiles).values({
        userId,
        displayName: profile.name ?? undefined,
        // Store the Google picture URL directly. Phase 4: proxy through Cloudinary.
        avatarPublicId: profile.picture ?? undefined,
      });
    } else {
      // Returning user — update lastSeenAt and refresh name/avatar from Google.
      await db.update(users)
        .set({ lastSeenAt: now })
        .where(eq(users.id, userId));

      // Upsert profile so name/avatar stays fresh if changed in Google.
      await db
        .insert(profiles)
        .values({
          userId,
          displayName: profile.name ?? undefined,
          avatarPublicId: profile.picture ?? undefined,
        })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: {
            displayName: profile.name ?? undefined,
            avatarPublicId: profile.picture ?? undefined,
            updatedAt: now,
          },
        });
    }

    const resolvedUserId: string = userId;

    // Create session.
    const sessionId = randomUUID();
    const tokenNonce = randomUUID();
    const tokenHash = createHash("sha256").update(tokenNonce).digest("hex");
    // Long-lived session — 30 days.
    const sessionExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const rawIp =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-real-ip") ??
      null;
    const ipHash = rawIp
      ? createHash("sha256").update(rawIp).digest("hex").slice(0, 16)
      : null;

    await db.insert(sessions).values({
      id: sessionId,
      userId: resolvedUserId,
      tokenHash,
      audience: "user",
      ipHash: ipHash ?? undefined,
      expiresAt: sessionExpiry,
    });

    // Mint realtime JWT (short-lived — 5 min).
    const realtimeToken = await mintRealtimeToken(
      {
        userId: resolvedUserId,
        sessionId,
        ageTier: "t1_estimated",
        trustBand: "normal",
        market: marketCode,
        region: "global",
        entitlements: ["chat:send", "video:call"],
        expiresInSeconds: 300,
      },
      {
        secret: env.BETTER_AUTH_SECRET,
        issuer: "freecall-auth",
        audience: "freecall-realtime",
      },
    );

    return { userId: resolvedUserId, sessionId, realtimeToken, isNewUser };
  } finally {
    await close({ timeout: 2 }).catch(() => undefined);
  }
}
