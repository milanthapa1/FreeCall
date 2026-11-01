"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LocaleMessages, SupportedLocale } from "@freecall/i18n";
import { AccountModal } from "./AccountModal";
import { MediaPermissionFlow } from "./MediaPermissionFlow";
import { RulesOverlay } from "./RulesOverlay";
import { useRealtimeSocket } from "../hooks/useRealtimeSocket";
import { useLiveKitCall } from "../hooks/useLiveKitCall";
import { useOnlineCount } from "../hooks/useOnlineCount";
import { useMe } from "../hooks/useMe";
import { UserMenu } from "./UserMenu";

interface LandingFlowProps {
  messages: LocaleMessages;
  initialLocale: SupportedLocale;
  marketCode: string;
}

type FlowStep = "idle" | "login" | "permissions" | "rules" | "queued" | "in_call";

export function LandingFlow({
  messages,
  initialLocale: _initialLocale,
  marketCode: _marketCode,
}: LandingFlowProps) {
  const [step, setStep] = useState<FlowStep>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{
    id: string; sender: "you" | "partner"; body: string; sentAt: number;
  }>>([]);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<
    "nudity" | "minor" | "violence" | "harassment" | "spam" | "scam" | "ncii" | "other"
  >("harassment");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onlineCount = useOnlineCount();
  const me = useMe();

  const currentCallIdRef = useRef<string | null>(null);
  currentCallIdRef.current = activeCallId;

  // Pick up realtime token from OAuth callback cookie, or fetch a fresh one if authenticated.
  useEffect(() => {
    // First check for the short-lived token set by the OAuth callback.
    const match = document.cookie.match(/(?:^|;\s*)fc_rt=([^;]+)/);
    if (match?.[1]) {
      setToken(decodeURIComponent(match[1]));
      document.cookie = "fc_rt=; max-age=0; path=/";
      setStep("permissions");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (authError) {
      setError(`Sign-in failed (${authError}). Please try again.`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Fetch a fresh realtime token whenever the user is authenticated but we don't have one.
  // This covers page reloads and direct navigation for already-logged-in users.
  useEffect(() => {
    if (me.status !== "authenticated" || token !== null) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/token", { credentials: "include", cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { token: string };
          setToken(data.token);
        }
      } catch {
        // Network error — user will see the start flow, which will retry.
      }
    })();

    return () => { cancelled = true; };
  }, [me.status, token]);

  // Auto-scroll chat.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isPartnerTyping]);

  const livekit = useLiveKitCall({
    onConnected: (roomSid) => {
      if (currentCallIdRef.current) socket.sendJoined(currentCallIdRef.current, roomSid);
    },
    onDisconnected: () => {},
    onError: (err) => setError(err.message),
  });

  const socket = useRealtimeSocket({
    token,
    onMatched: (event) => {
      setActiveCallId(event.data.call_id);
      setChatMessages([]);
      setStep("in_call");
      void livekit.connectToRoom(event.data.room_token);
    },
    onCallConnected: () => {},
    onCallEnded: (event) => {
      if (event.data.requeued) {
        setStep("queued");
        socket.enqueue({ country: "any", mode: "solo" });
      } else {
        void livekit.disconnect();
        setActiveCallId(null);
        setStep("idle");
      }
    },
    onCallFailed: () => socket.enqueue({ country: "any", mode: "solo" }),
    onPartnerLeft: () => handleNext(),
    onChat: (event) => {
      setChatMessages((prev) => [
        ...prev,
        { id: event.data.message_id, sender: event.data.sender, body: event.data.body, sentAt: event.data.sent_at },
      ]);
    },
    onTyping: (event) => setIsPartnerTyping(event.data.state === "start"),
    onQueued: () => {},
    onError: (event) => setError(event.data.message_key),
  });

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleStartClick = () => {
    setError(null);
    if (me.status === "authenticated") {
      // Already logged in — go straight to permissions.
      setStep("permissions");
    } else {
      setStep("login");
    }
  };

  const handleAuthSuccess = (t: string) => { setToken(t); setStep("permissions"); };
  const handlePermissionsGranted = (ms: MediaStream) => {
    // Attach local stream to the self-view video immediately.
    if (livekit.localVideoRef.current) {
      livekit.localVideoRef.current.srcObject = ms;
    }
    setStep("rules");
  };

  const handleStart = useCallback(() => {
    setStep("queued");
    setChatMessages([]);
    socket.enqueue({ country: "any", mode: "solo" });
  }, [socket]);

  const handleNext = useCallback(() => {
    // Only send skip — do NOT enqueue here. The server will send call_ended { requeued: true }
    // and onCallEnded below will enqueue. Enqueueing twice causes "already_enqueued" errors.
    if (activeCallId) socket.sendSkip(activeCallId, "next");
    setChatMessages([]);
  }, [activeCallId, socket]);

  const handleStop = useCallback(() => {
    if (activeCallId) socket.sendStop(activeCallId);
    void livekit.disconnect();
    setActiveCallId(null);
    setStep("idle");
  }, [activeCallId, livekit, socket]);

  const handleSendChat = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeCallId) return;
    socket.sendChat(activeCallId, chatInput.trim());
    setChatInput("");
    if (activeCallId) socket.sendTyping(activeCallId, "stop");
  }, [chatInput, activeCallId, socket]);

  const handleChatInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChatInput(e.target.value);
    if (activeCallId) {
      socket.sendTyping(activeCallId, "start");
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        if (activeCallId) socket.sendTyping(activeCallId, "stop");
      }, 1500);
    }
  };

  const handleReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeCallId) {
      socket.sendReport({
        callId: activeCallId,
        reason: reportReason,
        clientMsgIds: chatMessages.map((m) => m.id),
      });
    }
    setReportOpen(false);
  };

  // ── Derived state ────────────────────────────────────────────────────────────
  const isActive = step === "in_call";
  const isQueued = step === "queued";
  const canStart = step === "idle";
  const canNext = isActive || isQueued;
  const canStop = isActive || isQueued;

  const isAuthed = me.status === "authenticated";

  // Show OmeTV layout for authed users and once the call flow is underway.
  // Show landing hero only for unauthenticated idle users.
  const inCallFlow = step === "rules" || step === "queued" || step === "in_call";
  const showOmeTVLayout = isAuthed || inCallFlow;

  if (!showOmeTVLayout && step !== "permissions" && step !== "login") {
    return (
      <>
        <div className="flex min-h-dvh flex-col bg-black text-white">
          {/* Header */}
          <header className="flex items-center justify-between px-6 pt-6 pb-4">
            <span style={{ fontFamily: "'Dancing Script', cursive" }} className="text-3xl font-bold text-white select-none">
              FreeCall
            </span>
            <UserMenu />
          </header>

          {/* Hero */}
          <main className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            {onlineCount !== null && (
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-zinc-300">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{onlineCount.toLocaleString()} online now</span>
              </div>
            )}
            <h1 className="max-w-2xl text-4xl sm:text-6xl font-black tracking-tight leading-tight">
              {messages.landing.heroTitle}
            </h1>
            {error && <p className="mt-5 text-xs text-red-400">{error}</p>}
            <button
              type="button"
              onClick={handleStartClick}
              className="mt-10 w-full max-w-sm rounded-2xl py-4 text-base font-bold text-white shadow-lg active:scale-[0.99] transition-all"
              style={{ background: "#CF6C2A" }}
            >
              {messages.landing.startButton}
            </button>
          </main>

          <footer className="flex items-center justify-center gap-6 px-6 py-5 text-xs text-zinc-700">
            <a href="/rules" className="hover:text-zinc-400 transition-colors">Rules</a>
            <a href="/privacy" className="hover:text-zinc-400 transition-colors">Privacy</a>
            <span>© {new Date().getFullYear()} FreeCall</span>
          </footer>
        </div>

        {/* Login modal rendered here for unauthenticated users */}
        {(step as FlowStep) === "login" && (
          <AccountModal onSuccess={handleAuthSuccess} onCancel={() => setStep("idle")} />
        )}
      </>
    );
  }

  // ── Full OmeTV-style layout ──────────────────────────────────────────────────
  return (
    <>
      <div className="flex h-dvh flex-col bg-black text-white overflow-hidden">

        {/* Top bar */}
        <header
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <span style={{ fontFamily: "'Dancing Script', cursive" }} className="text-2xl font-bold text-white select-none">
            FreeCall
          </span>
          <div className="flex items-center gap-4">
            {onlineCount !== null && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {onlineCount.toLocaleString()} online
              </div>
            )}
            <UserMenu />
          </div>
        </header>

        {/* Main area — left: partner video | right: chat */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Video area (left, ~60%) ── */}
          <div className="relative flex-1 bg-zinc-950 overflow-hidden">

            {/* Partner / remote video — full fill */}
            <video
              ref={livekit.remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
              style={{ display: isActive ? "block" : "none" }}
            />

            {/* Waiting / idle overlay */}
            {!isActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                {isQueued ? (
                  <>
                    <div className="size-12 rounded-full border-4 border-zinc-700 border-t-white animate-spin" />
                    <p className="text-sm text-zinc-400">Finding someone…</p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-600">Press Start to begin</p>
                )}
              </div>
            )}

            {/* Self-view PiP — bottom-right corner */}
            <div
              className="absolute bottom-4 right-4 overflow-hidden rounded-xl shadow-2xl"
              style={{
                width: 140, height: 100,
                border: "2px solid rgba(255,255,255,0.15)",
                background: "#111",
              }}
            >
              <video
                ref={livekit.localVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
              {livekit.isCameraOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <span className="text-xs text-zinc-500">Cam off</span>
                </div>
              )}
            </div>

            {/* Partner country badge */}
            {isActive && (
              <div
                className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
              >
                <span className="size-2 rounded-full bg-emerald-400" />
                <span>Connected</span>
              </div>
            )}

            {/* Mic / camera toggles */}
            <div className="absolute bottom-4 left-4 flex gap-2">
              <button
                type="button"
                onClick={() => void livekit.toggleMic()}
                className="grid size-9 place-items-center rounded-full text-xs transition-all"
                style={{
                  background: livekit.isMicMuted ? "rgba(239,68,68,0.3)" : "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
                title={livekit.isMicMuted ? "Unmute" : "Mute"}
              >
                {livekit.isMicMuted ? "🔇" : "🎤"}
              </button>
              <button
                type="button"
                onClick={() => void livekit.toggleCamera()}
                className="grid size-9 place-items-center rounded-full text-xs transition-all"
                style={{
                  background: livekit.isCameraOff ? "rgba(239,68,68,0.3)" : "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
                title={livekit.isCameraOff ? "Camera on" : "Camera off"}
              >
                {livekit.isCameraOff ? "📵" : "📷"}
              </button>
            </div>
          </div>

          {/* ── Chat panel (right, ~320px) ── */}
          <div
            className="flex w-72 sm:w-80 shrink-0 flex-col"
            style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}
          >
            {/* Safety notice */}
            <div
              className="px-4 py-3 text-xs text-zinc-400 leading-relaxed shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              By pressing &quot;Start&quot;, you agree to our{" "}
              <a href="/rules" className="text-zinc-300 underline underline-offset-2">rules</a>.
              Rule violators will be banned.
              {isActive && (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="ml-2 text-red-400 hover:text-red-300 underline underline-offset-2"
                >
                  Report
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {chatMessages.length === 0 && (
                <p className="text-center text-xs text-zinc-600 mt-6">
                  {isActive ? "Say hello! 👋" : "Messages will appear here"}
                </p>
              )}
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.sender === "you" ? "items-end" : "items-start"}`}>
                  <div
                    className="max-w-[85%] rounded-2xl px-3 py-1.5 text-xs"
                    style={{
                      background: msg.sender === "you" ? "#CF6C2A" : "rgba(255,255,255,0.08)",
                      color: "#fff",
                    }}
                  >
                    {msg.body}
                  </div>
                </div>
              ))}
              {isPartnerTyping && (
                <p className="text-xs italic text-zinc-500">Partner is typing…</p>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <form
              onSubmit={handleSendChat}
              className="flex items-center gap-2 px-3 py-2.5 shrink-0"
              style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={handleChatInput}
                placeholder={isActive ? "Write a message…" : "Start a call to chat"}
                disabled={!isActive}
                maxLength={500}
                className="flex-1 rounded-xl px-3 py-2 text-xs bg-transparent focus:outline-none text-white placeholder-zinc-600 disabled:opacity-40"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <button
                type="submit"
                disabled={!isActive || !chatInput.trim()}
                className="grid size-8 place-items-center rounded-xl transition-all disabled:opacity-30"
                style={{ background: "#CF6C2A" }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
                  <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.199-7.794.75.75 0 0 0 0-1.088A28.897 28.897 0 0 0 3.105 2.288Z" />
                </svg>
              </button>
            </form>
          </div>
        </div>

        {/* ── Bottom controls ── */}
        <div
          className="flex items-center gap-3 px-5 py-3 shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          {/* Start */}
          <button
            type="button"
            disabled={!canStart}
            onClick={handleStart}
            className="flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: canStart ? "#22c55e" : "#166534", color: "#fff" }}
          >
            Start
          </button>

          {/* Stop */}
          <button
            type="button"
            disabled={!canStop}
            onClick={handleStop}
            className="flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: canStop ? "#CF6C2A" : "#431407", color: "#fff" }}
          >
            Stop
          </button>

          {/* Next */}
          <button
            type="button"
            disabled={!canNext}
            onClick={handleNext}
            className="flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: canNext ? "#fff" : "#555",
            }}
          >
            Next ›
          </button>
        </div>
      </div>

      {/* ── Overlays ── */}
      {step === "login" && (
        <AccountModal onSuccess={handleAuthSuccess} onCancel={() => setStep("idle")} />
      )}
      {step === "permissions" && (
        <MediaPermissionFlow
          messages={messages.permissions}
          onGranted={handlePermissionsGranted}
          onCancel={() => setStep("idle")}
        />
      )}
      {step === "rules" && (
        <RulesOverlay
          messages={messages.rulesOverlay}
          onConfirm={handleStart}
          onCancel={() => setStep("idle")}
        />
      )}

      {/* Report modal */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="px-6 pt-6 pb-2">
              <h3 className="text-base font-bold text-white mb-1">Report Partner</h3>
              <p className="text-xs text-zinc-500">This report will be reviewed by our safety team.</p>
            </div>
            <form onSubmit={handleReport} className="px-6 pb-6 pt-4 space-y-4">
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value as typeof reportReason)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-white bg-zinc-900 focus:outline-none"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <option value="nudity">Nudity or Sexual Content</option>
                <option value="minor">Suspected Minor</option>
                <option value="harassment">Harassment or Hate Speech</option>
                <option value="violence">Violence or Threats</option>
                <option value="spam">Spam or Advertising</option>
                <option value="scam">Scam or Fraud</option>
                <option value="ncii">Non-Consensual Imagery</option>
                <option value="other">Other</option>
              </select>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setReportOpen(false)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-zinc-400"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white"
                  style={{ background: "#ef4444" }}
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
