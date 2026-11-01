import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Community Rules",
  description: "Read the freecall community rules and acceptable use policy before chatting.",
};

export default async function RulesPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-100">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">
        Community Rules
      </h1>
      <div className="prose prose-invert prose-zinc max-w-none space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white">1. Age Requirement</h2>
          <p className="text-zinc-400">
            You must be 18 years or older to use freecall. Age assurance is required before
            matchmaking. We take this requirement seriously and violations result in a permanent ban.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">2. No Minors</h2>
          <p className="text-zinc-400">
            If you encounter anyone who appears to be under 18, end the call immediately and submit
            a report. This is the single most important rule on this platform.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">3. Consent</h2>
          <p className="text-zinc-400">
            All interactions must be consensual. Recording or sharing content from calls without
            explicit consent is strictly prohibited and may constitute a criminal offence.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">4. No Hate Speech or Harassment</h2>
          <p className="text-zinc-400">
            Slurs, threats, targeted harassment, and content that dehumanises people on the basis of
            race, ethnicity, religion, gender, sexual orientation, or disability are not permitted.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">5. Report Violations</h2>
          <p className="text-zinc-400">
            Use the in-call report button. Reports include the last 50 chat messages and a frame
            from your partner's video and are reviewed by our safety team 24/7.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white">6. Enforcement</h2>
          <p className="text-zinc-400">
            Violations result in immediate disconnection, temporary or permanent bans depending on
            severity. Serious violations (CSAM, threats, fraud) are referred to law enforcement.
          </p>
        </section>
      </div>
    </main>
  );
}
