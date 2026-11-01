/**
 * GET /api/auth/callback/google
 *
 * Handles the Google OAuth callback:
 * 1. Validates state to prevent CSRF.
 * 2. Exchanges authorisation code for tokens using PKCE.
 * 3. Fetches the user profile from Google's userinfo endpoint.
 * 4. Upserts the user + session and mints a realtime JWT.
 * 5. Redirects to the landing page with the token in a short-lived cookie.
 */

import { NextResponse, type NextRequest } from "next/server";
import { consumeOAuthCookies, upsertOAuthUser, type OAuthProfile } from "@/lib/oauth";
import { getWebEnv } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function GET(request: NextRequest) {
  let env;
  try {
    env = getWebEnv();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "environment configuration error";
    return NextResponse.json({ error: "configuration_error", detail: msg }, { status: 500 });
  }

  const { searchParams } = request.nextUrl;

  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  // User denied or provider error.
  if (oauthError) {
    return redirectWithError("oauth_denied", env.NEXT_PUBLIC_APP_URL);
  }

  if (!code || !returnedState) {
    return redirectWithError("missing_params", env.NEXT_PUBLIC_APP_URL);
  }

  // Validate state (CSRF protection).
  const stored = await consumeOAuthCookies();
  if (!stored || stored.state !== returnedState) {
    return redirectWithError("state_mismatch", env.NEXT_PUBLIC_APP_URL);
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return redirectWithError("not_configured", env.NEXT_PUBLIC_APP_URL);
  }

  const redirectUri = new URL("/api/auth/callback/google", env.NEXT_PUBLIC_APP_URL);

  // Exchange code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri.toString(),
      grant_type: "authorization_code",
      code_verifier: stored.verifier,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    return redirectWithError("token_exchange_failed", env.NEXT_PUBLIC_APP_URL);
  }

  const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
  if (tokenData.error) {
    return redirectWithError("token_error", env.NEXT_PUBLIC_APP_URL);
  }

  // Fetch user profile.
  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    cache: "no-store",
  });

  if (!userRes.ok) {
    return redirectWithError("profile_fetch_failed", env.NEXT_PUBLIC_APP_URL);
  }

  const googleUser = (await userRes.json()) as GoogleUserInfo;

  const profile: OAuthProfile = {
    provider: "google",
    providerUserId: googleUser.sub,
    email: googleUser.email ?? null,
    emailVerified: googleUser.email_verified ?? false,
    name: googleUser.name ?? null,
    picture: googleUser.picture ?? null,
  };

  const { sessionId, realtimeToken } = await upsertOAuthUser(profile, request);

  return redirectWithSession(sessionId, realtimeToken, env.NEXT_PUBLIC_APP_URL);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function redirectWithError(code: string, appUrl: string): NextResponse {
  const url = new URL(`/?auth_error=${code}`, appUrl);
  return NextResponse.redirect(url.toString());
}

function redirectWithSession(
  sessionId: string,
  realtimeToken: string,
  appUrl: string,
): NextResponse {
  const url = new URL("/", appUrl);
  const response = NextResponse.redirect(url.toString());

  const isProd = process.env["NODE_ENV"] === "production";

  // Session cookie — long-lived, httpOnly.
  response.cookies.set("fc_session", sessionId, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  // Realtime token cookie — short-lived, readable by JS so the client can
  // pick it up on the next page load and open the WebSocket.
  response.cookies.set("fc_rt", realtimeToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    maxAge: 300, // 5 minutes
    path: "/",
  });

  return response;
}
