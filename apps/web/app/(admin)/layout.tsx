import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

/**
 * Admin layout. Enforces a basic auth guard: only requests that carry a valid
 * ADMIN_SECRET cookie are allowed. Full RBAC (role column, DB check) lands in Phase 3.
 *
 * Set ADMIN_SECRET to a strong random string in your environment variables.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const adminSecret = process.env["ADMIN_SECRET"];
  if (adminSecret) {
    const jar = await cookies();
    const provided = jar.get("fc_admin")?.value;
    if (!provided || provided !== adminSecret) {
      redirect("/");
    }
  }
  return (
    <div className="min-h-dvh bg-zinc-950">
      <header className="border-b border-white/5 bg-zinc-900">
        <div className="flex items-center gap-4 px-6 py-3">
          <span className="rounded bg-rose-600/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-400">
            Admin
          </span>
          <a href="/" className="text-xs font-bold tracking-tight text-white">
            freecall
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
