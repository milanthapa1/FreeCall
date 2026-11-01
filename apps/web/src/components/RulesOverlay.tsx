"use client";

import React, { useState } from "react";
import type { LocaleMessages } from "@freecall/i18n";

interface RulesOverlayProps {
  messages: LocaleMessages["rulesOverlay"];
  onConfirm: () => void;
  onCancel: () => void;
}

export function RulesOverlay({ messages, onConfirm, onCancel }: RulesOverlayProps) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl text-white">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-400" />
            <h2 className="text-lg font-bold tracking-tight">{messages.title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="py-5 space-y-4">
          <div className="flex gap-3.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5">
            <span className="text-xl">👤</span>
            <div className="text-xs text-zinc-300 leading-relaxed">
              <strong className="block text-white mb-0.5">Real Face Required</strong>
              {messages.faceRequired}
            </div>
          </div>

          <div className="flex gap-3.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5">
            <span className="text-xl">🚫</span>
            <div className="text-xs text-zinc-300 leading-relaxed">
              <strong className="block text-white mb-0.5">No Nudity or Sexual Behavior</strong>
              {messages.noNudity}
            </div>
          </div>

          <div className="flex gap-3.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5">
            <span className="text-xl">📱</span>
            <div className="text-xs text-zinc-300 leading-relaxed">
              <strong className="block text-white mb-0.5">No Screens, Text or Signs</strong>
              {messages.noScreensOrText}
            </div>
          </div>

          <div className="flex gap-3.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5">
            <span className="text-xl">🛡️</span>
            <div className="text-xs text-zinc-300 leading-relaxed">
              <strong className="block text-white mb-0.5">Zero Harassment or Spam</strong>
              {messages.noHarassment}
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-800 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-4 rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500"
            />
            <span className="text-xs text-zinc-300 leading-normal">
              {messages.agreeCheckbox}
            </span>
          </label>

          <button
            type="button"
            disabled={!agreed}
            onClick={onConfirm}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] transition-all"
          >
            {messages.confirmButton}
          </button>
        </div>
      </div>
    </div>
  );
}
