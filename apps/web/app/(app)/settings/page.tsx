"use client";

import { useState } from "react";

/**
 * Settings page — account preferences.
 * Implements: display name, notification preferences, danger zone (sign out / delete).
 */
export default function SettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    // Optimistic save — backend profile update endpoint lands in Phase 4.
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-zinc-100">
      <h1 className="mb-8 text-2xl font-bold tracking-tight">Settings</h1>

      {/* Profile */}
      <section className="mb-8 rounded-2xl border border-white/10 bg-zinc-900 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Profile
        </h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="display-name" className="mb-1 block text-xs text-zinc-400">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
              placeholder="How others see you"
              className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: "#CF6C2A" }}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
          </button>
        </form>
      </section>

      {/* Preferences */}
      <section className="mb-8 rounded-2xl border border-white/10 bg-zinc-900 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Preferences
        </h2>
        <div className="space-y-3">
          {[
            { id: "pref-sound", label: "Sound effects", defaultChecked: true },
            { id: "pref-notify", label: "Partner connected notification", defaultChecked: false },
          ].map((pref) => (
            <label key={pref.id} htmlFor={pref.id} className="flex cursor-pointer items-center justify-between">
              <span className="text-sm text-zinc-300">{pref.label}</span>
              <input
                id={pref.id}
                type="checkbox"
                defaultChecked={pref.defaultChecked}
                className="h-4 w-4 accent-orange-500 cursor-pointer"
              />
            </label>
          ))}
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-red-900/40 bg-zinc-900 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-red-500">
          Danger zone
        </h2>
        <div className="space-y-3">
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full rounded-xl border border-white/10 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/5"
            >
              Sign out
            </button>
          </form>
          <button
            type="button"
            onClick={() => alert("Account deletion is handled via support. Email privacy@freecall.app.")}
            className="w-full rounded-xl border border-red-900/50 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-900/20"
          >
            Delete account
          </button>
        </div>
      </section>

      <p className="mt-8 text-center text-xs text-zinc-700">
        More account controls (history, age verification, billing) coming soon.
      </p>
    </main>
  );
}
