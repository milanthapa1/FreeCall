"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";

export interface UseLiveKitCallOptions {
  livekitUrl?: string;
  onConnected?: (roomSid: string) => void;
  onDisconnected?: () => void;
  onError?: (err: Error) => void;
}

export function useLiveKitCall(options: UseLiveKitCallOptions = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const optionsRef = useRef(options);
  // Track dynamically created audio elements so we can clean them up
  const audioElementsRef = useRef<HTMLAudioElement[]>([]);
  optionsRef.current = options;

  const defaultLivekitUrl =
    options.livekitUrl ??
    (typeof window !== "undefined"
      ? (process.env["NEXT_PUBLIC_LIVEKIT_URL"] ?? "ws://localhost:7880")
      : "ws://localhost:7880");

  const connectToRoom = useCallback(
    async (token: string, wsUrl?: string) => {
      const url = wsUrl ?? defaultLivekitUrl;

      // Clean up previous room if any
      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        setConnectionState(state);
      });

      room.on(RoomEvent.Connected, () => {
        optionsRef.current.onConnected?.(room.name);
      });

      room.on(RoomEvent.Disconnected, () => {
        setConnectionState(ConnectionState.Disconnected);
        optionsRef.current.onDisconnected?.();
      });

      room.on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality) => {
        setQuality(q);
      });

      room.on(
        RoomEvent.TrackSubscribed,
        (track: Track, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
          } else if (track.kind === Track.Kind.Audio) {
            // Bug fix: element must be in the DOM or browsers will GC it and silence audio.
            const audioElement = document.createElement("audio");
            audioElement.autoplay = true;
            audioElement.style.display = "none";
            document.body.appendChild(audioElement);
            audioElementsRef.current.push(audioElement);
            track.attach(audioElement);
          }
        },
      );

      try {
        await room.connect(url, token);
        // Publish local camera and mic tracks
        await room.localParticipant.enableCameraAndMicrophone();

        // Attach local video track to self-view element
        const videoTrack = room.localParticipant
          .getTrackPublications()
          .find((p) => p.kind === Track.Kind.Video)?.videoTrack;
        if (videoTrack && localVideoRef.current) {
          videoTrack.attach(localVideoRef.current);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        optionsRef.current.onError?.(error);
      }
    },
    [defaultLivekitUrl],
  );

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
    // Clean up all audio elements attached to the DOM.
    for (const el of audioElementsRef.current) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    audioElementsRef.current = [];
    setConnectionState(ConnectionState.Disconnected);
  }, []);

  const toggleMic = useCallback(async () => {
    if (!roomRef.current) return;
    const isMuted = !isMicMuted;
    await roomRef.current.localParticipant.setMicrophoneEnabled(!isMuted);
    setIsMicMuted(isMuted);
  }, [isMicMuted]);

  const toggleCamera = useCallback(async () => {
    if (!roomRef.current) return;
    const isOff = !isCameraOff;
    await roomRef.current.localParticipant.setCameraEnabled(!isOff);
    setIsCameraOff(isOff);
  }, [isCameraOff]);

  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      // Clean up audio elements on unmount.
      for (const el of audioElementsRef.current) {
        el.pause();
        el.srcObject = null;
        el.remove();
      }
      audioElementsRef.current = [];
    };
  }, []);

  return {
    connectionState,
    quality,
    isMicMuted,
    isCameraOff,
    localVideoRef,
    remoteVideoRef,
    connectToRoom,
    disconnect,
    toggleMic,
    toggleCamera,
  };
}
