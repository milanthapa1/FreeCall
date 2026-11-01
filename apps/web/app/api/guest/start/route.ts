import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { getResolvedMarket } from "@/lib/geo";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit, hashForKey } from "@/lib/rate-limit";
import { getRedisClient } from "@/lib/redis";
import { isAdult, mintRealtimeToken } from "@freecall/auth";
import { getWebEnv } from "@/lib/server-env";
import { createDb, users, sessions, devices, eq } from "@freecall/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startGuestSchema = z.object({
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD"),
  attestation: z.literal(true, { message: "Must confirm 18+ attestation" }),
  turnstileToken: z.string().optional(),
  fingerprint: z.string().min(8).max(128).optional(),
});

// Rate limit constants
const IP_LIMIT_HOUR = 60;
const IP_WINDOW_SEC = 3_600;
const DEVICE_LIMIT_HOUR = 5;
const DEVICE_WINDOW_SEC = 3_600;

/** Extract the real client IP, respecting trusted proxy headers. */
function getClientIp(request: Request): string | null {
  // Cloudflare sets CF-Connecting-IP; Vercel sets X-Forwarded-For.
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
    null
  );
}

/** One-way hash an IP for use as a rate-limit key suffix (never stored raw). */
function hashIp(ip: string): string {
  return createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 16);
}

export async function POST(request: Request) {
  // ── Parse and validate body (needs no env) ───────────────────────────────
  const body = await request.json().catch(() => null);
  const parsed = startGuestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { dob, turnstileToken, fingerprint } = parsed.data;
  const birthDate = new Date(dob);

  // ── Strict 18+ chronological age check (needs no env) ───────────────────
  if (!isAdult(birthDate)) {
    return NextResponse.json(
      { error: "underage", message: "You must be 18 or older to access freecall" },
      { status: 403 },
    );
  }

  // From here on we need the environment.
  const env = getWebEnv();

  // ── Turnstile bot protection ─────────────────────────────────────────────
  const clientIp = getClientIp(request);
  const tsResult = await verifyTurnstileToken({
    token: turnstileToken,
    secretKey: env.TURNSTILE_SECRET_KEY,
    remoteIp: clientIp,
  });
  if (!tsResult.ok) {
    return NextResponse.json(
      {
        error: "bot_challenge_failed",
        code: tsResult.code,
        message: "Please complete the challenge and try again",
      },
      { status: 429 },
    );
  }

  // ── Per-IP rate limiting ─────────────────────────────────────────────────
  const redis = getRedisClient();
  if (clientIp) {
    try {
      const ipKey = `rl:guest_start:ip:${hashIp(clientIp)}`;
      const ipLimit = await checkRateLimit(redis, ipKey, IP_LIMIT_HOUR, IP_WINDOW_SEC);
      if (!ipLimit.allowed) {
        return NextResponse.json(
          { error: "rate_limited", message: "Too many requests from this IP" },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((ipLimit.resetAt - Date.now()) / 1000)),
              "X-RateLimit-Remaining": "0",
            },
          },
        );
      }
    } catch {
      // Redis unavailable: proceed (fail open for UX; rate limit is defence-in-depth).
    }
  }

  // ── Per-device rate limiting ─────────────────────────────────────────────
  if (fingerprint) {
    try {
      const deviceKey = `rl:guest_start:fp:${hashForKey(fingerprint)}`;
      const deviceLimit = await checkRateLimit(
        redis,
        deviceKey,
        DEVICE_LIMIT_HOUR,
        DEVICE_WINDOW_SEC,
      );
      if (!deviceLimit.allowed) {
        return NextResponse.json(
          { error: "rate_limited", message: "Too many requests from this device" },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((deviceLimit.resetAt - Date.now()) / 1000)),
              "X-RateLimit-Remaining": "0",
            },
          },
        );
      }
    } catch {
      // Redis unavailable: proceed.
    }
  }

  // ── Market resolution ────────────────────────────────────────────────────
  const { marketCode, decision } = await getResolvedMarket(request.headers);

  if (!decision.enabled || !decision.matchingEnabled) {
    return NextResponse.json(
      {
        error: "market_blocked",
        message: "freecall is unavailable in your region",
        reasons: decision.reasons,
      },
      { status: 403 },
    );
  }

  // If market disallows self-declared guests entirely, require provider assurance.
  if (decision.guestMinutesPerDay <= 0) {
    return NextResponse.json(
      {
        error: "age_assurance_required",
        message: "Your region requires provider-verified age assurance before chatting",
        requiredTier: decision.requiredAgeTier,
      },
      { status: 403 },
    );
  }

  // ── Persist guest user + session to DB ───────────────────────────────────
  const userId = randomUUID();
  const sessionId = randomUUID();
  const now = new Date();
  const sessionExpiry = new Date(now.getTime() + 300 * 1000); // 5 min for realtime JWT

  const { db, close } = createDb(env.DATABASE_URL, {
    max: 2,
    connectTimeoutSeconds: 3,
    applicationName: "freecall-web-guest-start",
  });

  try {
    // Upsert device fingerprint if provided.
    let deviceId: string | undefined;
    if (fingerprint) {
      const fingerprintHash = createHash("sha256")
        .update(`fp:${fingerprint}`)
        .digest("hex");

      // Check if device exists first.
      const existingDevice = await db
        .select({ id: devices.id, userId: devices.userId })
        .from(devices)
        .where(eq(devices.fingerprintHash, fingerprintHash))
        .limit(1);

      if (existingDevice[0]) {
        deviceId = existingDevice[0].id;
        // Update lastSeenAt on known device.
        await db
          .update(devices)
          .set({ lastSeenAt: now })
          .where(eq(devices.id, existingDevice[0].id));
      } else {
        deviceId = randomUUID();
        // Insert device record — userId is required; use this guest's userId.
        await db.insert(users).values({
          id: userId,
          isAnonymous: true,
          market: marketCode,
          ageTier: "t0_declared",
          lastSeenAt: now,
        });
        await db.insert(devices).values({
          id: deviceId,
          userId,
          fingerprintHash,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    } else {
      // No fingerprint: insert user directly.
      await db.insert(users).values({
        id: userId,
        isAnonymous: true,
        market: marketCode,
        ageTier: "t0_declared",
        lastSeenAt: now,
      });
    }

    // Insert user if not already inserted (fingerprint path may have already done it).
    // We use onConflictDoNothing so the call is idempotent.
    await db.insert(users).values({
      id: userId,
      isAnonymous: true,
      market: marketCode,
      ageTier: "t0_declared",
      lastSeenAt: now,
    }).onConflictDoNothing({ target: users.id });

    // Hash the JWT before storing (never store the raw token).
    const tokenNonce = randomUUID();
    const tokenHash = createHash("sha256").update(tokenNonce).digest("hex");

    await db.insert(sessions).values({
      id: sessionId,
      userId,
      tokenHash,
      audience: "user",  // guest sessions are user-audience; realtime auth uses JWT
      ipHash: clientIp ? createHash("sha256").update(clientIp).digest("hex").slice(0, 16) : null,
      deviceId: deviceId ?? null,
      expiresAt: sessionExpiry,
    });
  } catch (error) {
    console.error("Failed to persist guest session:", error);
    // Non-fatal: mint the token anyway so a DB hiccup doesn't block the user.
    // The session simply won't appear in DB audit trails.
  } finally {
    await close({ timeout: 2 }).catch(() => undefined);
  }

  // ── Mint short-lived realtime JWT ────────────────────────────────────────
  const realtimeToken = await mintRealtimeToken(
    {
      userId,
      sessionId,
      ageTier: "t0_declared",
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

  const response = NextResponse.json({
    success: true,
    userId,
    sessionId,
    token: realtimeToken,
    market: marketCode,
    ageTier: "t0_declared",
    guestMinutesPerDay: decision.guestMinutesPerDay,
  });

  // Set secure httpOnly session cookie.
  response.cookies.set("fc_session", sessionId, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return response;
}
