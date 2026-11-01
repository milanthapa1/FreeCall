/**
 * GET /api/auth/google
 *
 * Initiates the Google OAuth 2.0 PKCE flow.
 * Redirects the browser to Google's authorisation endpoint.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  generateCodeVerifier,
  generateState,
  codeChallenge,
  writeOAuthCookies,
} from "@/lib/oauth";
import { getWebEnv } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Load env — if it throws, return a clear 500 message instead of an unhandled crash.
  let env;
  try {
    env = getWebEnv();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "environment configuration error";
    return NextResponse.json({ error: "configuration_error", detail: msg }, { status: 500 });
  }

  // Google credentials must be configured before this endpoint is usable.
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      {
        error: "google_not_configured",
        message:
          "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env.local file. " +
          "Get them at https://console.cloud.google.com → APIs & Services → Credentials.",
      },
      { status: 503 },
    );
  }

  const _attestation = request.nextUrl.searchParams.get("attestation");
  // attestation param is sent by the client as a signal that the user clicked sign in.

  const state = generateState();
  const verifier = generateCodeVerifier();
  await writeOAuthCookies(state, verifier);

  const redirectUri = new URL("/api/auth/callback/google", env.NEXT_PUBLIC_APP_URL);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri.toString(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "select_account",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
