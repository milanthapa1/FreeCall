import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createDb, reports, bans, eq, desc, sql } from "@freecall/db";
import { getWebEnv } from "@/lib/server-env";

/**
 * Moderator console — server-rendered with live DB data.
 * Access is protected by the admin layout (fc_admin cookie check).
 */
export default async function AdminPage() {
  // Verify admin session cookie (belt-and-suspenders over the layout guard).
  const jar = await cookies();
  const adminSecret = process.env["ADMIN_SECRET"];
  if (adminSecret && jar.get("fc_admin")?.value !== adminSecret) {
    redirect("/");
  }

  let env;
  try {
    env = getWebEnv();
  } catch {
    return (
      <ErrorState message="Environment not configured. Cannot connect to database." />
    );
  }

  const { db, close } = createDb(env.DATABASE_URL, {
    max: 1,
    connectTimeoutSeconds: 3,
    applicationName: "freecall-web-admin",
  });

  let openReports = 0;
  let activeBans = 0;
  let recentReports: Array<{
    id: string;
    reason: string;
    status: string;
    severity: string;
    callId: string;
    createdAt: Date;
  }> = [];

  try {
    // Parallel queries.
    const [reportCount, banCount, latestReports] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(reports)
        .where(eq(reports.status, "open")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(bans)
        .where(sql`${bans.revokedAt} is null and (${bans.expiresAt} is null or ${bans.expiresAt} > now())`),
      db
        .select({
          id: reports.id,
          reason: reports.reason,
          status: reports.status,
          severity: reports.severity,
          callId: reports.callId,
          createdAt: reports.createdAt,
        })
        .from(reports)
        .orderBy(desc(reports.createdAt))
        .limit(20),
    ]);

    openReports = reportCount[0]?.count ?? 0;
    activeBans = banCount[0]?.count ?? 0;
    recentReports = latestReports.map((r) => ({
      ...r,
      callId: r.callId,
    }));
  } catch (err) {
    console.error("Admin page DB error:", err);
  } finally {
    await close({ timeout: 2 }).catch(() => undefined);
  }

  const severityColor = (s: string) => {
    if (s === "critical") return "text-red-400 bg-red-900/20";
    if (s === "high") return "text-orange-400 bg-orange-900/20";
    return "text-yellow-400 bg-yellow-900/20";
  };

  const statusColor = (s: string) => {
    if (s === "open") return "text-amber-400";
    if (s === "resolved") return "text-emerald-400";
    return "text-zinc-400";
  };

  return (
    <main className="min-h-dvh bg-zinc-950 p-6 text-zinc-100">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Moderation Console</h1>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Open Reports", value: openReports, color: "text-amber-400" },
          { label: "Active Bans", value: activeBans, color: "text-rose-400" },
          { label: "Recent (24h)", value: recentReports.filter(r => {
            const h = Date.now() - new Date(r.createdAt).getTime();
            return h < 86_400_000;
          }).length, color: "text-blue-400" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/10 bg-zinc-900 p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {stat.label}
            </p>
            <p className={`mt-2 text-3xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Recent reports table */}
      <section className="rounded-2xl border border-white/10 bg-zinc-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-zinc-300">Recent Reports</h2>
        </div>
        {recentReports.length === 0 ? (
          <p className="px-5 py-8 text-sm text-zinc-600 text-center">No reports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-left text-zinc-500">
                  <th className="px-5 py-3 font-medium">Reason</th>
                  <th className="px-5 py-3 font-medium">Severity</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Call ID</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentReports.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-medium capitalize">{r.reason}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${severityColor(r.severity)}`}>
                        {r.severity}
                      </span>
                    </td>
                    <td className={`px-5 py-3 font-medium capitalize ${statusColor(r.status)}`}>
                      {r.status}
                    </td>
                    <td className="px-5 py-3 font-mono text-zinc-500">
                      {r.callId.slice(0, 8)}…
                    </td>
                    <td className="px-5 py-3 text-zinc-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 p-8">
      <div className="rounded-2xl border border-red-900/40 bg-zinc-900 p-8 text-center max-w-sm">
        <p className="text-sm font-semibold text-red-400 mb-2">Configuration Error</p>
        <p className="text-xs text-zinc-500">{message}</p>
      </div>
    </main>
  );
}
