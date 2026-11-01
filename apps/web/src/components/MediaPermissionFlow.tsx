"use client";

import React, { useRef, useState } from "react";
import type { LocaleMessages } from "@freecall/i18n";

interface MediaPermissionFlowProps {
  messages: LocaleMessages["permissions"];
  onGranted: (stream: MediaStream) => void;
  onCancel: () => void;
}

export function MediaPermissionFlow({
  messages,
  onGranted,
  onCancel,
}: MediaPermissionFlowProps) {
  const [status, setStatus] = useState<"idle" | "requesting" | "denied" | "no_device" | "preview">("idle");
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const requestPermissions = async (audioOnly: boolean = false) => {
    setStatus("requesting");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus("no_device");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: !audioOnly,
        audio: true,
      });

      setActiveStream(stream);
      setStatus("preview");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: unknown) {
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setStatus("denied");
          return;
        }
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setStatus("no_device");
          return;
        }
      }
      setStatus("denied");
    }
  };

  const handleConfirm = () => {
    if (activeStream) {
      onGranted(activeStream);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl text-white">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <h2 className="text-lg font-bold tracking-tight">{messages.title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="py-6 text-center space-y-4">
          {status === "idle" && (
            <>
              <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-zinc-900 border border-zinc-800 text-3xl">
                📹
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed max-w-xs mx-auto">
                {messages.description}
              </p>
              <button
                type="button"
                onClick={() => requestPermissions(false)}
                className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black hover:bg-amber-400 active:scale-[0.99] transition-all"
              >
                {messages.requestButton}
              </button>
            </>
          )}

          {status === "requesting" && (
            <div className="py-8 space-y-3">
              <div className="mx-auto size-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <p className="text-xs text-zinc-400">Requesting media access from browser...</p>
            </div>
          )}

          {status === "preview" && (
            <div className="space-y-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900 border border-zinc-800">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="size-full object-cover -scale-x-100"
                />
                <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-medium text-emerald-400 backdrop-blur-sm">
                  ● Camera Active
                </span>
              </div>
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black hover:bg-amber-400 active:scale-[0.99] transition-all"
              >
                Continue to Chat
              </button>
            </div>
          )}

          {status === "denied" && (
            <div className="space-y-4 text-left">
              <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-4">
                <h3 className="font-semibold text-red-300 text-sm mb-1">{messages.deniedTitle}</h3>
                <p className="text-xs text-red-200/80 leading-relaxed">{messages.deniedMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => requestPermissions(false)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                Retry Permissions
              </button>
            </div>
          )}

          {status === "no_device" && (
            <div className="space-y-4 text-left">
              <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-4">
                <h3 className="font-semibold text-amber-300 text-sm mb-1">{messages.noDevicesTitle}</h3>
                <p className="text-xs text-amber-200/80 leading-relaxed">{messages.noDevicesMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => requestPermissions(true)}
                className="w-full rounded-xl bg-amber-500 py-2.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors"
              >
                {messages.audioFallbackButton}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
