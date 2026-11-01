"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  parseServerEvent,
  type ClientEvent,
  type ServerEvent,
} from "@freecall/protocol";

export type SocketStatus = "disconnected" | "connecting" | "connected" | "closing";

export interface UseRealtimeSocketOptions {
  token: string | null;
  wsUrl?: string;
  onEvent?: (event: ServerEvent) => void;
  onMatched?: (event: Extract<ServerEvent, { type: "matched" }>) => void;
  onCallConnected?: (event: Extract<ServerEvent, { type: "call_connected" }>) => void;
  onCallEnded?: (event: Extract<ServerEvent, { type: "call_ended" }>) => void;
  onCallFailed?: (event: Extract<ServerEvent, { type: "call_failed" }>) => void;
  onPartnerLeft?: (event: Extract<ServerEvent, { type: "partner_left" }>) => void;
  onChat?: (event: Extract<ServerEvent, { type: "chat" }>) => void;
  onChatAck?: (event: Extract<ServerEvent, { type: "chat_ack" }>) => void;
  onTyping?: (event: Extract<ServerEvent, { type: "typing" }>) => void;
  onQueued?: (event: Extract<ServerEvent, { type: "queued" }>) => void;
  onError?: (event: Extract<ServerEvent, { type: "error" }>) => void;
}

export function useRealtimeSocket(options: UseRealtimeSocketOptions) {
  const [status, setStatus] = useState<SocketStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const resolvedWsUrl =
    options.wsUrl ??
    (typeof window !== "undefined"
      ? (process.env["NEXT_PUBLIC_REALTIME_WS_URL"] ?? "ws://localhost:8080/v1")
      : "ws://localhost:8080/v1");

  const sendEvent = useCallback((event: ClientEvent) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  const enqueue = useCallback(
    (opts: {
      country?: string;
      mode?: "solo" | "couple";
      lang?: string;
      own_gender?: "m" | "f" | "x";
      strict_gender?: boolean;
    }) => {
      sendEvent({
        v: PROTOCOL_VERSION,
        type: "enqueue",
        id: crypto.randomUUID(),
        data: {
          country: (opts.country as "any") ?? "any",
          mode: opts.mode ?? "solo",
          lang: opts.lang ?? "en",
          own_gender: opts.own_gender,
          strict_gender: opts.strict_gender ?? false,
        },
      });
    },
    [sendEvent],
  );

  const sendJoined = useCallback(
    (callId: string, roomSid?: string) => {
      sendEvent({
        v: PROTOCOL_VERSION,
        type: "joined",
        id: crypto.randomUUID(),
        data: {
          call_id: callId,
          room_sid: roomSid,
        },
      });
    },
    [sendEvent],
  );

  const sendSkip = useCallback(
    (callId: string, reason: "next" | "inappropriate" = "next") => {
      sendEvent({
        v: PROTOCOL_VERSION,
        type: "skip",
        id: crypto.randomUUID(),
        data: {
          call_id: callId,
          reason,
        },
      });
    },
    [sendEvent],
  );

  const sendStop = useCallback(
    (callId: string) => {
      sendEvent({
        v: PROTOCOL_VERSION,
        type: "stop",
        id: crypto.randomUUID(),
        data: {
          call_id: callId,
        },
      });
    },
    [sendEvent],
  );

  const sendChat = useCallback(
    (callId: string, body: string, clientMsgId?: string) => {
      sendEvent({
        v: PROTOCOL_VERSION,
        type: "chat",
        id: crypto.randomUUID(),
        data: {
          call_id: callId,
          body,
          client_msg_id: clientMsgId ?? crypto.randomUUID(),
        },
      });
    },
    [sendEvent],
  );

  const sendTyping = useCallback(
    (callId: string, state: "start" | "stop") => {
      sendEvent({
        v: PROTOCOL_VERSION,
        type: "typing",
        id: crypto.randomUUID(),
        data: {
          call_id: callId,
          state,
        },
      });
    },
    [sendEvent],
  );

  const sendReport = useCallback(
    (opts: {
      callId: string;
      reason: "nudity" | "minor" | "violence" | "harassment" | "spam" | "scam" | "ncii" | "other";
      note?: string;
      clientMsgIds?: string[];
      frameUploadId?: string;
    }) => {
      sendEvent({
        v: PROTOCOL_VERSION,
        type: "report",
        id: crypto.randomUUID(),
        data: {
          call_id: opts.callId,
          reason: opts.reason,
          note: opts.note,
          client_msg_ids: opts.clientMsgIds ?? [],
          frame_upload_id: opts.frameUploadId,
        },
      });
    },
    [sendEvent],
  );

  useEffect(() => {
    if (!options.token) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("disconnected");
      return;
    }

    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      setStatus("connecting");

      try {
        const ws = new WebSocket(resolvedWsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isDisposed) {
            ws.close();
            return;
          }
          setStatus("connected");
          reconnectAttemptRef.current = 0;

          // Authenticate with token
          ws.send(
            JSON.stringify({
              v: PROTOCOL_VERSION,
              type: "hello",
              id: crypto.randomUUID(),
              data: {
                token: optionsRef.current.token,
                client: {
                  platform: "web",
                  version: "1.0.0",
                  locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
                },
              },
            }),
          );
        };

        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(event.data);
          } catch {
            return;
          }

          const result = parseServerEvent(parsedJson);
          if (!result.ok) return;

          const serverEv = result.value;
          optionsRef.current.onEvent?.(serverEv);

          switch (serverEv.type) {
            case "matched":
              optionsRef.current.onMatched?.(serverEv);
              break;
            case "call_connected":
              optionsRef.current.onCallConnected?.(serverEv);
              break;
            case "call_ended":
              optionsRef.current.onCallEnded?.(serverEv);
              break;
            case "call_failed":
              optionsRef.current.onCallFailed?.(serverEv);
              break;
            case "partner_left":
              optionsRef.current.onPartnerLeft?.(serverEv);
              break;
            case "chat":
              optionsRef.current.onChat?.(serverEv);
              break;
            case "chat_ack":
              optionsRef.current.onChatAck?.(serverEv);
              break;
            case "typing":
              optionsRef.current.onTyping?.(serverEv);
              break;
            case "queued":
              optionsRef.current.onQueued?.(serverEv);
              break;
            case "error":
              optionsRef.current.onError?.(serverEv);
              break;
          }
        };

        ws.onclose = (event) => {
          if (isDisposed) return;
          setStatus("disconnected");
          wsRef.current = null;

          // Reconnect with exponential backoff if not closed cleanly
          if (event.code !== 1000 && event.code !== 4001 && event.code !== 4004) {
            const nextAttempt = reconnectAttemptRef.current + 1;
            if (nextAttempt <= 5) {
              reconnectAttemptRef.current = nextAttempt;
              const delay = Math.min(1000 * Math.pow(2, nextAttempt), 10000);
              reconnectTimerRef.current = setTimeout(connect, delay);
            }
          }
        };

        ws.onerror = () => {
          if (isDisposed) return;
          ws.close();
        };
      } catch {
        setStatus("disconnected");
      }
    }

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("disconnected");
    };
  }, [options.token, resolvedWsUrl]);

  return {
    status,
    sendEvent,
    enqueue,
    sendJoined,
    sendSkip,
    sendStop,
    sendChat,
    sendTyping,
    sendReport,
  };
}
