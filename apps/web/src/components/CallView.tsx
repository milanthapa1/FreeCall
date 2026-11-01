"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export interface ChatMessageItem {
  id: string;
  sender: "you" | "partner";
  body: string;
  sentAt: number;
}

export interface PartnerInfo {
  country: string;
  lang: string;
  mode: string;
  band: string;
  age_tier: string;
}

interface CallViewProps {
  callId: string;
  partner?: PartnerInfo;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  isMicMuted: boolean;
  isCameraOff: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onSkip: () => void;
  onStop: () => void;
  onSendChat: (body: string) => void;
  onTyping: (state: "start" | "stop") => void;
  onReport: (opts: {
    reason: "nudity" | "minor" | "violence" | "harassment" | "spam" | "scam" | "ncii" | "other";
    note?: string;
  }) => void;
  chatMessages: ChatMessageItem[];
  isPartnerTyping?: boolean;
}

export function CallView({
  callId: _callId,
  partner,
  localVideoRef,
  remoteVideoRef,
  isMicMuted,
  isCameraOff,
  onToggleMic,
  onToggleCamera,
  onSkip,
  onStop,
  onSendChat,
  onTyping,
  onReport,
  chatMessages,
  isPartnerTyping = false,
}: CallViewProps) {
  const [inputText, setInputText] = useState("");
  const [showChat, setShowChat] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<
    "nudity" | "minor" | "violence" | "harassment" | "spam" | "scam" | "ncii" | "other"
  >("harassment");
  const [reportNote, setReportNote] = useState("");
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keyboard shortcut: Press 'S' to skip
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        (e.key === "s" || e.key === "S") &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        onSkip();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSkip]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    onTyping("start");
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      onTyping("stop");
    }, 1500);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendChat(inputText.trim());
    setInputText("");
    onTyping("stop");
  };

  const handleQuickEmoji = (emoji: string) => {
    onSendChat(emoji);
  };

  const handleSubmitReport = (e: React.FormEvent) => {
    e.preventDefault();
    onReport({ reason: reportReason, note: reportNote });
    setShowReportModal(false);
    setReportNote("");
  };

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-black text-white">
      {/* Main Video View Area */}
      <div className="relative flex-1">
        {/* Remote Video (Full Screen / Main) */}
        <div className="relative h-full w-full bg-zinc-950">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
          {/* Partner Info Badge */}
          {partner && (
            <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-xs font-semibold backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Partner: {partner.country.toUpperCase()}</span>
              <span className="text-zinc-500">•</span>
              <span className="text-zinc-400 capitalize">{partner.lang}</span>
            </div>
          )}
        </div>

        {/* Self View (Picture-in-Picture) */}
        <div className="absolute bottom-24 right-4 z-20 h-44 w-32 overflow-hidden rounded-xl border border-white/20 bg-zinc-900 shadow-2xl sm:bottom-24 sm:right-6 sm:h-52 sm:w-40">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${isCameraOff ? "hidden" : ""}`}
          />
          {isCameraOff && (
            <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-xs text-zinc-500">
              Camera Off
            </div>
          )}
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-300 backdrop-blur-sm">
            You
          </span>
        </div>

        {/* In-Call Chat Overlay (Slide-over on right for desktop, toggleable) */}
        {showChat && (
          <div className="absolute top-4 right-4 bottom-24 z-10 flex w-72 flex-col rounded-2xl border border-white/10 bg-black/75 p-3 backdrop-blur-lg sm:w-80">
            <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Live Chat
              </span>
              <button
                type="button"
                onClick={() => setShowChat(false)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Hide
              </button>
            </div>

            {/* Message History */}
            <div className="flex-1 space-y-2 overflow-y-auto pr-1 text-sm">
              {chatMessages.length === 0 && (
                <p className="mt-8 text-center text-xs text-zinc-500">
                  Say hi to your partner! Press S to skip.
                </p>
              )}
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.sender === "you" ? "items-end" : "items-start"
                  }`}
                >
                  <span
                    className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-xs ${
                      msg.sender === "you"
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-800 text-zinc-200"
                    }`}
                  >
                    {msg.body}
                  </span>
                </div>
              ))}
              {isPartnerTyping && (
                <p className="text-xs italic text-zinc-400">Partner is typing...</p>
              )}
            </div>

            {/* Quick Emojis */}
            <div className="my-2 flex gap-1 border-t border-white/10 pt-2">
              {["👋", "😂", "❤️", "🔥", "✨"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleQuickEmoji(emoji)}
                  className="rounded p-1 text-sm hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSend} className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                placeholder="Type a message..."
                maxLength={500}
                className="flex-1 rounded-xl border border-white/10 bg-zinc-900/90 px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Send
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Bottom Control Bar */}
      <div className="relative z-30 flex h-20 items-center justify-between border-t border-white/10 bg-zinc-950 px-4 sm:px-8">
        {/* Left: Stop / Report buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-2 rounded-xl bg-rose-600/20 px-4 py-2.5 text-xs font-bold text-rose-400 transition-colors hover:bg-rose-600 hover:text-white"
          >
            <span>Stop</span>
          </button>
          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            Report
          </button>
        </div>

        {/* Center: Skip (Next) Main Action */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onSkip}
            className="flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-3 text-sm font-bold text-black shadow-lg shadow-emerald-500/30 transition-transform active:scale-95 hover:bg-emerald-400"
          >
            <span>Next</span>
            <kbd className="hidden rounded bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-950 sm:inline-block">
              S
            </kbd>
          </button>
        </div>

        {/* Right: Media toggles & Chat toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMic}
            className={`rounded-xl p-2.5 text-xs transition-colors ${
              isMicMuted
                ? "bg-rose-500/20 text-rose-400"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
            title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
          >
            {isMicMuted ? "Mic Off" : "Mic On"}
          </button>

          <button
            type="button"
            onClick={onToggleCamera}
            className={`rounded-xl p-2.5 text-xs transition-colors ${
              isCameraOff
                ? "bg-rose-500/20 text-rose-400"
                : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
            title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
          >
            {isCameraOff ? "Cam Off" : "Cam On"}
          </button>

          {!showChat && (
            <button
              type="button"
              onClick={() => setShowChat(true)}
              className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              Chat
            </button>
          )}
        </div>
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="mb-2 text-lg font-bold text-white">Report Partner</h3>
            <p className="mb-4 text-xs text-zinc-400">
              Reports include the last 50 chat messages and are reviewed by safety moderators 24/7.
            </p>

            <form onSubmit={handleSubmitReport} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-300">
                  Reason for Report
                </label>
                <select
                  value={reportReason}
                  onChange={(e) =>
                    setReportReason(
                      e.target.value as
                        | "nudity"
                        | "minor"
                        | "violence"
                        | "harassment"
                        | "spam"
                        | "scam"
                        | "ncii"
                        | "other",
                    )
                  }
                  className="w-full rounded-xl border border-white/10 bg-zinc-800 p-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="nudity">Nudity or Sexual Content</option>
                  <option value="minor">Suspected Minor / Under 18</option>
                  <option value="harassment">Harassment or Hate Speech</option>
                  <option value="violence">Violence or Threats</option>
                  <option value="spam">Advertising or Spam</option>
                  <option value="scam">Scam or Fraud</option>
                  <option value="ncii">Non-Consensual Imagery</option>
                  <option value="other">Other Violation</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-300">
                  Additional Notes (Optional)
                </label>
                <textarea
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)}
                  maxLength={500}
                  placeholder="Describe the violation..."
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-zinc-800 p-2.5 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white hover:bg-rose-500"
                >
                  Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
