import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How freecall collects, uses and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-100">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mb-8 text-sm text-zinc-400">
        Last updated: 30 October 2026. This policy describes how freecall processes personal data
        in accordance with GDPR, UK GDPR, CCPA, and other applicable regulations.
      </p>
      <div className="space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Data We Collect</h2>
          <ul className="list-inside list-disc space-y-1 text-zinc-400">
            <li>Age attestation date (not stored as a birthdate after verification)</li>
            <li>Device fingerprint hash (SHA-256, purpose-limited to fraud prevention)</li>
            <li>IP address hash (SHA-256, rate limiting and geo-resolution only)</li>
            <li>Chat messages during a call (cleared after call ends unless reported)</li>
            <li>Moderation signals (classifier scores, never raw frames in the database)</li>
            <li>Report evidence (retained 24 months for legal compliance)</li>
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Data Retention</h2>
          <p className="text-zinc-400">
            Guest sessions: 30 days. Call records: 90 days by default (market-specific). Evidence
            in restricted storage: 24 months. Permanent bans: indefinitely for legal compliance.
            You may request deletion via the DSAR process below.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold text-white">Your Rights (GDPR / UK GDPR)</h2>
          <p className="text-zinc-400">
            You have the right to access, rectify, erase, and port your data. Submit a request at{" "}
            <a href="mailto:privacy@freecall.app" className="text-emerald-400 underline">
              privacy@freecall.app
            </a>
            . We respond within 30 days. Deletion requests involving active moderation cases may be
            deferred until the case is closed.
          </p>
        </section>
      </div>
    </main>
  );
}
