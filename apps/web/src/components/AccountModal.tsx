"use client";

import React, { useState } from "react";

interface AccountModalProps {
  onCancel: () => void;
  onSuccess: (token: string) => void;
}

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const SpinnerIcon = () => (
  <svg className="size-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 12 0 12 0c0 6.627 5.373 12 12 12h-4a8 8 0 01-8 8v4c-6.627 0-12-5.373-12-12z" />
  </svg>
);

export function AccountModal({ onCancel, onSuccess: _onSuccess }: AccountModalProps) {
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = () => {
    setLoading(true);
    window.location.href = "/api/auth/google?attestation=1";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl overflow-hidden"
        style={{
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg transition-colors"
          style={{ color: "#666", background: "transparent" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#666"; }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>

        {/* Top section */}
        <div className="px-8 pt-10 pb-6 text-center">
          {/* Cursive brand */}
          <p
            style={{ fontFamily: "'Dancing Script', cursive", color: "#fff" }}
            className="text-3xl font-bold mb-3"
          >
            FreeCall
          </p>

          {/* Divider line */}
          <div style={{ width: 32, height: 2, background: "#CF6C2A", margin: "0 auto 16px" }} />

          <p style={{ color: "#888", fontSize: 14 }}>
            Sign in to start a video call
          </p>
        </div>

        {/* Button section */}
        <div className="px-8 pb-6">
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleSignIn}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#fff",
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "rgba(255,255,255,0.09)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
          >
            {loading ? <SpinnerIcon /> : <GoogleIcon />}
            <span>{loading ? "Redirecting…" : "Continue with Google"}</span>
          </button>
        </div>

        {/* Footer note */}
        <div
          className="px-8 py-4 text-center"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <p style={{ fontSize: 11, color: "#555", lineHeight: 1.6 }}>
            By continuing you agree to our{" "}
            <a
              href="/rules"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#888" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; }}
            >
              Rules
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#888" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; }}
            >
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
