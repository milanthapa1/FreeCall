"use client";

import React, { useEffect, useRef, useState } from "react";
import { useMe } from "../hooks/useMe";

export function UserMenu() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // While loading or unauthenticated — render nothing.
  if (me.status !== "authenticated") return null;

  const { user } = me;
  const initials = user.displayName
    ? user.displayName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-xl px-3 py-1.5 transition-colors"
        style={{
          background: open ? "rgba(255,255,255,0.08)" : "transparent",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = open ? "rgba(255,255,255,0.08)" : "transparent"; }}
      >
        {/* Avatar */}
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.displayName ?? "avatar"}
            referrerPolicy="no-referrer"
            className="size-7 rounded-full object-cover ring-1 ring-white/10"
          />
        ) : (
          <div
            className="size-7 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: "#CF6C2A", color: "#fff" }}
          >
            {initials}
          </div>
        )}

        {/* Name — hidden on very small screens */}
        <span className="hidden sm:block text-sm font-medium text-white max-w-[120px] truncate">
          {user.displayName ?? user.email ?? "Account"}
        </span>

        {/* Chevron */}
        <svg
          viewBox="0 0 12 12"
          fill="currentColor"
          className="size-3 text-zinc-500"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-56 rounded-xl overflow-hidden z-50"
          style={{
            background: "#111",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          }}
        >
          {/* User info header */}
          <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-sm font-semibold text-white truncate">
              {user.displayName ?? "Anonymous"}
            </p>
            {user.email && (
              <p className="text-xs text-zinc-500 truncate mt-0.5">{user.email}</p>
            )}
          </div>

          {/* Menu items */}
          <div className="py-1.5">
            <a
              href="/settings"
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 transition-colors"
              style={{ textDecoration: "none" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = ""; }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4 text-zinc-500">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
              Settings
            </a>
          </div>

          {/* Sign out */}
          <div className="py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <form method="POST" action="/api/auth/signout">
              <button
                type="submit"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-zinc-400 transition-colors"
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#f87171"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = ""; }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
                  <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M6 10a.75.75 0 0 1 .75-.75h9.546l-1.048-.943a.75.75 0 1 1 1.004-1.114l2.5 2.25a.75.75 0 0 1 0 1.114l-2.5 2.25a.75.75 0 1 1-1.004-1.114l1.048-.943H6.75A.75.75 0 0 1 6 10Z" clipRule="evenodd" />
                </svg>
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
