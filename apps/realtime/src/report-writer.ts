/**
 * ReportWriter — persists user reports to the `reports` table.
 *
 * Runs in the realtime process so reports are written immediately, not after
 * the call ends. The write is fire-and-forget from the session's perspective
 * (session.ts calls .catch on the returned promise).
 *
 * Uses a short-lived single connection per write so a slow DB never blocks
 * the WebSocket event loop.
 */
import { createDb, reports } from "@freecall/db";
import type { ReportWriter } from "./session.js";

export function createReportWriter(databaseUrl: string): ReportWriter {
  return {
    async writeReport(opts) {
      const { db, close } = createDb(databaseUrl, {
        max: 1,
        connectTimeoutSeconds: 3,
        applicationName: "freecall-realtime-report",
      });

      try {
        await db
          .insert(reports)
          .values({
            id: opts.reportId,
            callId: opts.callId,
            reporterId: opts.reporterId,
            reportedId: opts.reportedId,
            reason: opts.reason,
            note: opts.note ?? null,
            // Store the list of chat message IDs in evidenceManifestKey as a JSON string
            // until the evidence worker assembles them into an S3 object.
            evidenceManifestKey: opts.chatMessageIds.length > 0
              ? JSON.stringify(opts.chatMessageIds)
              : null,
          })
          .onConflictDoNothing(); // idempotent: unique(callId, reporterId)
      } finally {
        await close({ timeout: 2 }).catch(() => undefined);
      }
    },
  };
}
