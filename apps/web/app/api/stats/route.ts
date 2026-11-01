/**
 * GET /api/stats
 *
 * Returns the live online count by proxying the realtime health server's /stats endpoint.
 * Cached for 10 seconds at the edge so every browser tab doesn't hammer the realtime pod.
 *
 * Falls back to null if the realtime server is unreachable (dev without realtime running).
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REALTIME_HEALTH_URL =
  process.env["REALTIME_HEALTH_URL"] ?? "http://127.0.0.1:8081";

export async function GET(): Promise<NextResponse> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);

    const res = await fetch(`${REALTIME_HEALTH_URL}/stats`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ onlineCount: null }, { status: 200 });
    }

    const data = (await res.json()) as { onlineCount: number };

    return NextResponse.json(
      { onlineCount: data.onlineCount },
      {
        status: 200,
        headers: {
          // Cache 10 s at the CDN edge; stale-while-revalidate for smoothness.
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
        },
      },
    );
  } catch {
    // Realtime server not running locally — return null so the UI hides the counter.
    return NextResponse.json({ onlineCount: null }, { status: 200 });
  }
}
