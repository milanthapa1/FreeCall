/**
 * Evidence assembly processor.
 *
 * Builds and uploads the evidence bundle for a report:
 * 1. Encodes the chat log as JSON.
 * 2. Uploads the frame JPEG (if provided).
 * 3. Assembles a signed manifest linking both objects.
 * 4. Updates the `reports` row with the manifest key and SHA-256.
 */

import type { Job } from "bullmq";
import { randomUUID, createHash } from "node:crypto";
import type { Database } from "@freecall/db";
import { reports, eq } from "@freecall/db";
import type { EvidenceStorage } from "@freecall/providers";
import type { Logger } from "@freecall/observability";
import type { EvidenceJob } from "../queues.js";

export interface EvidenceProcessorDeps {
  db: Database;
  storage: EvidenceStorage;
  logger: Logger;
}

export async function processEvidenceJob(
  job: Job<EvidenceJob>,
  deps: EvidenceProcessorDeps,
): Promise<void> {
  const { data } = job;
  const { db, storage, logger } = deps;

  const uploads: Array<{ type: string; key: string; sha256: string }> = [];

  // Upload frame if provided.
  if (data.frameBase64) {
    const frameBuffer = Buffer.from(data.frameBase64, "base64");
    const frameUpload = await storage.upload({
      content: frameBuffer,
      contentType: "image/jpeg",
      reportId: data.reportId,
      caseType: "frame",
      metadata: {
        reported_user_id: data.reportedId,
        reporter_user_id: data.reporterId,
        call_id: data.callId,
      },
    });
    uploads.push({ type: "frame", ...frameUpload });
    logger.info("evidence.frame.uploaded", {
      reportId: data.reportId,
      sha: frameUpload.sha256.slice(0, 16),
    });
  }

  // Upload chat log.
  const chatLog = JSON.stringify(
    {
      reportId: data.reportId,
      callId: data.callId,
      exportedAt: new Date().toISOString(),
      messages: data.chatMessages,
    },
    null,
    2,
  );
  const chatBuffer = Buffer.from(chatLog, "utf8");
  const chatUpload = await storage.upload({
    content: chatBuffer,
    contentType: "application/json",
    reportId: data.reportId,
    caseType: "chat_export",
  });
  uploads.push({ type: "chat_export", ...chatUpload });

  // Build and upload manifest.
  const manifest = {
    version: 1,
    reportId: data.reportId,
    callId: data.callId,
    reporterId: data.reporterId,
    reportedId: data.reportedId,
    reason: data.reason,
    note: data.note,
    assembledAt: new Date().toISOString(),
    uploads,
  };
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const manifestSha256 = createHash("sha256").update(manifestBuffer).digest("hex");
  const manifestUpload = await storage.upload({
    content: manifestBuffer,
    contentType: "application/json",
    reportId: data.reportId,
    caseType: "manifest",
  });

  // Update the reports row with evidence pointers.
  await db
    .update(reports)
    .set({
      evidenceManifestKey: manifestUpload.key,
      evidenceSha256: manifestSha256,
    })
    .where(eq(reports.id, data.reportId));

  logger.info("evidence.assembled", {
    reportId: data.reportId,
    sha: manifestSha256.slice(0, 16),
    count: uploads.length,
  });
}
