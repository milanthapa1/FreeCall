/**
 * BullMQ queue definitions.
 *
 * All job types and their payloads are defined here. Producers (realtime, web) import
 * these types so the payload contract is shared and type-safe.
 */

export interface ModerationJob {
  type: "frame" | "text";
  userId: string;
  callId: string;
  /** Base64-encoded frame (for type="frame"). */
  frameBase64?: string;
  mimeType?: "image/jpeg" | "image/png";
  /** Chat text (for type="text"). */
  text?: string;
  lang?: string;
  policyVersion: string;
}

export interface EvidenceJob {
  reportId: string;
  callId: string;
  reporterId: string;
  reportedId: string;
  /** Base64-encoded JPEG frame captured by the reporting client. */
  frameBase64?: string;
  /** Last N chat messages from the client buffer. */
  chatMessages: Array<{
    id: string;
    sender: "you" | "partner";
    body: string;
    sentAt: number;
  }>;
  reason: string;
  note?: string;
}

export interface BanJob {
  userId: string;
  triggerType: "auto_moderation" | "moderator" | "appeal_denied";
  scope: "call" | "dm" | "upload" | "platform";
  reasonCode: string;
  policyVersion: string;
  expiresInHours?: number; // undefined = permanent
  moderatorId?: string;
}

export interface EmailJob {
  type: "ban_notification" | "appeal_received" | "appeal_decided" | "safety_digest";
  recipientId: string;
  recipientEmail: string;
  payload: Record<string, unknown>;
}

export interface ReportJob {
  reportId: string;
  severity: "low" | "medium" | "high" | "critical";
  autoEscalate: boolean;
}

export const QUEUE_NAMES = {
  moderation: "freecall:moderation",
  evidence: "freecall:evidence",
  bans: "freecall:bans",
  email: "freecall:email",
  reports: "freecall:reports",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
