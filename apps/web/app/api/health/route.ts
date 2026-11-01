import { httpStatusFor } from "@freecall/observability";
import { getHealthReport } from "@/lib/health-checks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + dependency report for the web tier.
 *
 * `degraded` stays in rotation because the product is still usable without optional
 * services (object storage in a developer checkout); `down` returns 503 so the load
 * balancer removes the instance. The body names dependencies and coarse failure classes,
 * never connection strings or upstream messages.
 */
export async function GET(): Promise<Response> {
  const report = await getHealthReport();
  return Response.json(report, {
    status: httpStatusFor(report.status),
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
