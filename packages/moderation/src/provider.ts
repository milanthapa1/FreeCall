/**
 * Moderation provider interface.
 *
 * All provider adapters implement `ModerationProvider`. The worker loads the configured
 * adapter at startup and dispatches frames / text through it without knowing which
 * vendor is in use.
 */

import type { ModerationLabel } from "./labels.js";

export interface ClassificationResult {
  /** Canonical label. */
  label: ModerationLabel;
  /** Confidence score in [0, 1]. */
  score: number;
  /** Raw vendor response, stored as evidence. */
  raw: unknown;
  /** Model identifier (e.g. "hive-v2"). */
  model: string;
  /** Model version string. */
  modelVersion: string;
}

export interface FrameClassificationInput {
  /** Base-64 encoded JPEG or PNG. */
  imageBase64: string;
  /** MIME type. */
  mimeType: "image/jpeg" | "image/png";
  /** Associated call id for logging. */
  callId: string;
  /** User id for logging. */
  userId: string;
}

export interface TextClassificationInput {
  text: string;
  callId: string;
  userId: string;
  lang: string;
}

export interface ModerationProvider {
  name: string;
  /** Classify a single video frame. Returns multiple labels sorted by score desc. */
  classifyFrame(input: FrameClassificationInput): Promise<ClassificationResult[]>;
  /** Classify a text message. Returns labels sorted by score desc. */
  classifyText(input: TextClassificationInput): Promise<ClassificationResult[]>;
  /** Health check: returns true if the provider is reachable. */
  ping(): Promise<boolean>;
}
