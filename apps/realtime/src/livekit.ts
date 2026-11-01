/**
 * LiveKit integration for freecall realtime service.
 *
 * Wraps the official livekit-server-sdk to:
 *   - Create rooms for matched pairs
 *   - Mint participant tokens
 *   - Close rooms on call end
 */
import type { AgeTier } from "@freecall/protocol";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import type { VideoGrant } from "livekit-server-sdk";

export interface LiveKitConfig {
  apiKey: string;
  apiSecret: string;
  apiUrl: string;
}

export interface RoomTokens {
  roomName: string;
  tokenA: string;
  tokenB: string;
  expiresAt: number;
}

const ROOM_EMPTY_TIMEOUT_SEC = 60;
const ROOM_DEPARTURE_TIMEOUT_SEC = 15;
/** Token TTL: enough for connect + call duration allowance. */
const TOKEN_TTL_SEC = 3600; // 1 hour; LiveKit will revoke on room close

export class LiveKitClient {
  private readonly roomService: RoomServiceClient;
  private readonly config: LiveKitConfig;

  constructor(config: LiveKitConfig) {
    this.config = config;
    this.roomService = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  }

  /**
   * Create a LiveKit room for a matched pair.
   * Room name = callId (uuid v4 format).
   */
  async createRoom(callId: string): Promise<string> {
    const roomName = `call-${callId}`;
    await this.roomService.createRoom({
      name: roomName,
      emptyTimeout: ROOM_EMPTY_TIMEOUT_SEC,
      departureTimeout: ROOM_DEPARTURE_TIMEOUT_SEC,
      maxParticipants: 2,
    });
    return roomName;
  }

  /**
   * Mint two tokens (one per participant) for a 1:1 call room.
   * Tokens are JWT strings the client passes to livekit-client Room.connect().
   */
  async mintRoomTokens(opts: {
    roomName: string;
    sidA: string;
    sidB: string;
    ageTierA: AgeTier;
    ageTierB: AgeTier;
  }): Promise<RoomTokens> {
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;

    const tokenA = await this.mintToken({
      roomName: opts.roomName,
      participantId: opts.sidA,
      ageTier: opts.ageTierA,
      ttl: TOKEN_TTL_SEC,
    });

    const tokenB = await this.mintToken({
      roomName: opts.roomName,
      participantId: opts.sidB,
      ageTier: opts.ageTierB,
      ttl: TOKEN_TTL_SEC,
    });

    return {
      roomName: opts.roomName,
      tokenA,
      tokenB,
      expiresAt,
    };
  }

  /**
   * Close a LiveKit room. Called when a call ends for any reason.
   * Fails silently if the room doesn't exist (already cleaned up).
   */
  async closeRoom(roomName: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(roomName);
    } catch {
      // Room may not exist; ignore.
    }
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private async mintToken(opts: {
    roomName: string;
    participantId: string;
    ageTier: AgeTier;
    ttl: number;
  }): Promise<string> {
    const grant: VideoGrant = {
      room: opts.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      // Moderator flag for age-verified users (used by egress sampler).
      roomAdmin: opts.ageTier === "t2_verified",
    };

    const token = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: opts.participantId,
      ttl: opts.ttl,
    });
    token.addGrant(grant);
    // Include ageTier as metadata for egress-side moderation.
    token.metadata = JSON.stringify({ ageTier: opts.ageTier });

    return await token.toJwt();
  }
}

/** Build a LiveKitClient from environment variables. */
export function createLiveKitClient(env: {
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  LIVEKIT_API_URL: string;
}): LiveKitClient {
  return new LiveKitClient({
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    apiUrl: env.LIVEKIT_API_URL,
  });
}


