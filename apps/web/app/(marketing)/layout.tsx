import type { ReactNode } from "react";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-zinc-950">
      <header className="border-b border-white/5">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <a href="/" className="text-sm font-bold tracking-tight text-white">
            freecall
          </a>
          <nav className="flex items-center gap-4 text-xs text-zinc-400">
            <a href="/rules" className="hover:text-white transition-colors">
              Rules
            </a>
            <a href="/privacy" className="hover:text-white transition-colors">
              Privacy
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-white/5 py-8">
        <p className="text-center text-xs text-zinc-600">
          © 2026 freecall. Adults only. 18+.
        </p>
      </footer>
    </div>
  );
}
