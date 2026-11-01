/**
 * GET /api/auth/token
 *
 * Mints a fresh short-lived realtime JWT for the currently authenticated session.
 * Called by the client when it needs to open a WebSocket but has no token in memory.
 *
 * Returns 401 when the session cookie is missing or expired.
 * Returns a 5-minute JWT on success — the client must re-call before it expires.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createDb, sessions, users, eq, and, gt } from "@freecall/db";
import { mintRealtimeToken } from "@freecall/auth";
import { getWebEnv } from "@/lib/server-env";
import { getResolvedMarket } from "@/lib/geo";
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  const sessionId = jar.get("fc_session")?.value;

  if (!sessionId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let env;
  try {
    env = getWebEnv();
  } catch {
    return NextResponse.json({ error: "configuration_error" }, { status: 500 });
  }

  const { db, close } = createDb(env.DATABASE_URL, {
    max: 1,
    connectTimeoutSeconds: 3,
    applicationName: "freecall-web-token",
  });

  try {
    const now = new Date();

    const rows = await db
      .select({ userId: users.id, ageTier: users.ageTier, market: users.market })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.id, sessionId),
          gt(sessions.expiresAt, now),
          eq(users.status, "active"),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const { userId, ageTier, market } = rows[0];

    // Resolve region from request headers.
    const reqHeaders = await headers();
    const { marketCode } = await getResolvedMarket(reqHeaders);

    const realtimeToken = await mintRealtimeToken(
      {
        userId,
        sessionId,
        ageTier,
        trustBand: "normal",
        market: marketCode || market,
        region: "global",
        entitlements: ["chat:send", "video:call"],
        expiresInSeconds: 300, // 5 minutes
      },
      {
        secret: env.BETTER_AUTH_SECRET,
        issuer: "freecall-auth",
        audience: "freecall-realtime",
      },
    );

    return NextResponse.json(
      { token: realtimeToken, expiresInSeconds: 300 },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } finally {
    await close({ timeout: 2 }).catch(() => undefined);
  }
}
