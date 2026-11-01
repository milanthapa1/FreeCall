/**
 * GET /api/me
 *
 * Returns the authenticated user's public profile from the fc_session cookie.
 * Returns 401 when no valid session exists — never throws.
 *
 * Response shape:
 *   { id, displayName, avatarUrl, email, isNewUser }
 *
 * avatarUrl is the Google picture URL for now; Phase 4 proxies it through Cloudinary.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createDb, sessions, users, profiles, eq, and, gt } from "@freecall/db";
import { getWebEnv } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface MeResponse {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export async function GET(): Promise<NextResponse> {
  // Read session cookie.
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
    applicationName: "freecall-web-me",
  });

  try {
    const now = new Date();

    // Join session → user → profile in one query.
    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        displayName: profiles.displayName,
        avatarPublicId: profiles.avatarPublicId,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          eq(sessions.id, sessionId),
          gt(sessions.expiresAt, now),           // not expired
          eq(users.status, "active"),             // not banned/suspended
        ),
      )
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const row = rows[0];

    const me: MeResponse = {
      id: row.userId,
      displayName: row.displayName ?? null,
      // avatarPublicId currently stores the Google picture URL directly.
      avatarUrl: row.avatarPublicId ?? null,
      email: row.email ?? null,
    };

    return NextResponse.json(me, {
      status: 200,
      headers: {
        // Don't cache at the CDN — this is user-specific.
        "Cache-Control": "private, no-store",
      },
    });
  } finally {
    await close({ timeout: 2 }).catch(() => undefined);
  }
}
