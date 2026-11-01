"use client";

import React, { useState } from "react";
import type { LocaleMessages } from "@freecall/i18n";

interface AgeGateModalProps {
  messages: LocaleMessages["ageGate"];
  onSuccess: (dob: string) => void;
  onCancel: () => void;
  requiresProviderAssurance?: boolean;
}

export function AgeGateModal({
  messages,
  onSuccess,
  onCancel,
  requiresProviderAssurance = false,
}: AgeGateModalProps) {
  const [dob, setDob] = useState("");
  const [attestation, setAttestation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!dob) {
      setError("Please enter your date of birth.");
      return;
    }

    if (!attestation) {
      setError("You must confirm you are at least 18 years old.");
      return;
    }

    const birthDate = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birthDate.getFullYear();
    const monthDiff = now.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      setError(messages.underageError);
      return;
    }

    onSuccess(dob);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl text-white">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <h2 className="text-xl font-bold tracking-tight">{messages.title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {requiresProviderAssurance ? (
          <div className="py-6 space-y-4">
            <p className="text-sm text-zinc-300 leading-relaxed">
              {messages.providerAssurancePrompt}
            </p>
            <button
              type="button"
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black hover:bg-amber-400 transition-colors"
            >
              {messages.providerAssuranceButton}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="py-6 space-y-5">
            <p className="text-sm text-zinc-400 leading-relaxed">
              {messages.description}
            </p>

            <div>
              <label htmlFor="dob-input" className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-2">
                {messages.dobLabel}
              </label>
              <input
                id="dob-input"
                type="date"
                required
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={attestation}
                onChange={(e) => setAttestation(e.target.checked)}
                className="mt-1 size-4 rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500"
              />
              <span className="text-xs text-zinc-300 leading-normal">
                {messages.attestationCheckbox}
              </span>
            </label>

            {error && (
              <div className="rounded-lg bg-red-950/80 border border-red-800/60 p-3 text-xs text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black hover:bg-amber-400 active:scale-[0.99] transition-all"
            >
              {messages.submitButton}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
