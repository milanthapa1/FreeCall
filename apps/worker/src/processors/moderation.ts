/**
 * Moderation queue processor.
 *
 * Classifies a frame or text message and writes the result to `moderation_events`.
 * If a label exceeds its threshold, the recommended action is applied via the bans queue.
 *
 * This processor MUST NOT call moderation vendors inline from the realtime path. It runs
 * asynchronously after the call, never adding latency to the match.
 */

import type { Job } from "bullmq";
import { randomUUID } from "node:crypto";
import type { Database } from "@freecall/db";
import { moderationEvents } from "@freecall/db";
import type { ModerationProvider } from "@freecall/moderation";
import {
  exceedsThreshold,
  recommendAction,
  requiresImmediateEscalation,
} from "@freecall/moderation";
import type { Logger } from "@freecall/observability";
import type { ModerationJob } from "../queues.js";
import type { Queue } from "bullmq";
import type { BanJob } from "../queues.js";

export interface ModerationProcessorDeps {
  db: Database;
  provider: ModerationProvider;
  bansQueue: Queue<BanJob>;
  logger: Logger;
  policyVersion: string;
}

export async function processModerationJob(
  job: Job<ModerationJob>,
  deps: ModerationProcessorDeps,
): Promise<void> {
  const { data } = job;
  const { db, provider, bansQueue, logger } = deps;

  let results;
  if (data.type === "frame") {
    if (!data.frameBase64) throw new Error("frame job missing frameBase64");
    results = await provider.classifyFrame({
      imageBase64: data.frameBase64,
      mimeType: data.mimeType ?? "image/jpeg",
      callId: data.callId,
      userId: data.userId,
    });
  } else {
    if (!data.text) throw new Error("text job missing text");
    results = await provider.classifyText({
      text: data.text,
      callId: data.callId,
      userId: data.userId,
      lang: data.lang ?? "en",
    });
  }

  // Write every result as a moderation_event row.
  for (const result of results) {
    const action = recommendAction(result.label, result.score);

    await db.insert(moderationEvents).values({
      id: randomUUID(),
      userId: data.userId,
      callId: data.callId,
      source: data.type === "frame" ? "visual" : "text",
      label: result.label,
      score: String(result.score),
      model: result.model,
      modelVersion: result.modelVersion,
      policyVersion: data.policyVersion,
      actionTaken: action,
    });

    // Immediate escalation for CSAM — fail closed.
    if (requiresImmediateEscalation(result.label)) {
      logger.error("moderation.csam_detected", {
        userId: data.userId,
        callId: data.callId,
        reasonCode: result.label,
        durationMs: Math.round(result.score * 1000), // encode score as a numeric allowed field
      });
      await bansQueue.add(
        "auto_ban",
        {
          userId: data.userId,
          triggerType: "auto_moderation",
          scope: "platform",
          reasonCode: `auto:${result.label}:${result.model}@${data.policyVersion}:${result.score.toFixed(3)}`,
          policyVersion: data.policyVersion,
        },
        { priority: 1 },
      );
      return; // Stop processing further labels after CSAM.
    }

    if (exceedsThreshold(result.label, result.score) && action !== "none") {
      logger.warn("moderation.threshold_exceeded", {
        userId: data.userId,
        callId: data.callId,
        reasonCode: result.label,
        action,
      });

      if (action === "temp_ban" || action === "permanent_ban") {
        await bansQueue.add("auto_ban", {
          userId: data.userId,
          triggerType: "auto_moderation",
          scope: "call",
          reasonCode: `auto:${result.label}:${result.model}@${data.policyVersion}:${result.score.toFixed(3)}`,
          policyVersion: data.policyVersion,
          expiresInHours: action === "temp_ban" ? 24 : undefined,
        });
      }
    }
  }
}
