/**
 * POST /api/auth/signout
 *
 * Revokes the current session in the database and clears all auth cookies.
 * Always redirects to / so a plain <form> submit works without JS.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createDb, sessions, eq } from "@freecall/db";
import { getWebEnv } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const sessionId = jar.get("fc_session")?.value;

  // Clear cookies regardless of whether the session exists in DB.
  const response = NextResponse.redirect(
    new URL("/", process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000"),
  );

  const isProd = process.env["NODE_ENV"] === "production";
  const cookieBase = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

  response.cookies.set("fc_session", "", { ...cookieBase, maxAge: 0 });
  response.cookies.set("fc_rt", "", { ...cookieBase, httpOnly: false, maxAge: 0 });

  if (!sessionId) return response;

  // Revoke in DB (best-effort — don't block the redirect on a slow DB).
  try {
    const env = getWebEnv();
    const { db, close } = createDb(env.DATABASE_URL, {
      max: 1,
      connectTimeoutSeconds: 3,
      applicationName: "freecall-web-signout",
    });
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    await close({ timeout: 2 }).catch(() => undefined);
  } catch {
    // Silent — the cookie is already cleared so the user is effectively signed out.
  }

  return response;
}
