/**
 * Ban processor.
 *
 * Writes a `bans` row and caches the ban key in Redis so the realtime path can check it
 * without a DB round-trip. Ban writes are idempotent: the unique index on
 * `bans_one_active_permanent_per_scope` prevents double-bans.
 *
 * Also writes an `audit_logs` row for every automated ban action.
 */

import type { Job } from "bullmq";
import { randomUUID } from "node:crypto";
import type { Database } from "@freecall/db";
import { bans, auditLogs, redisBanKey } from "@freecall/db";
import type Redis from "ioredis";
import type { Logger } from "@freecall/observability";
import type { BanJob } from "../queues.js";

const BAN_CACHE_TTL_SEC = 86_400; // 24 hours — sufficient for realtime checks

export interface BanProcessorDeps {
  db: Database;
  redis: Redis;
  logger: Logger;
}

export async function processBanJob(
  job: Job<BanJob>,
  deps: BanProcessorDeps,
): Promise<void> {
  const { data } = job;
  const { db, redis, logger } = deps;

  const banId = randomUUID();
  const now = new Date();
  const expiresAt = data.expiresInHours
    ? new Date(now.getTime() + data.expiresInHours * 3_600_000)
    : null;

  try {
    await db.insert(bans).values({
      id: banId,
      userId: data.userId,
      scope: data.scope,
      reasonCode: data.reasonCode,
      issuedBy: data.triggerType === "moderator" ? "moderator" : "system",
      issuedById: data.moderatorId ?? null,
      startsAt: now,
      expiresAt,
    });

    // Cache in Redis for realtime hot-path check.
    const key = redisBanKey(data.userId);
    if (expiresAt) {
      const ttlSec = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);
      await redis.set(key, "1", "EX", Math.min(ttlSec, BAN_CACHE_TTL_SEC));
    } else {
      // Permanent ban: large TTL, refreshed by a background job.
      await redis.set(key, "1", "EX", BAN_CACHE_TTL_SEC);
    }

    await db.insert(auditLogs).values({
      id: randomUUID(),
      actorRole: data.moderatorId ? "moderator" : null,
      action: "ban.create",
      targetType: "user",
      targetId: data.userId,
      after: {
        banId,
        scope: data.scope,
        reasonCode: data.reasonCode,
        permanent: expiresAt === null,
        policyVersion: data.policyVersion,
      },
      reasonCode: data.reasonCode,
    });

    logger.info("ban.created", {
      userId: data.userId,
      banId,
      policyVersion: data.policyVersion,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Unique constraint: ban already exists — idempotent, not an error.
    if (msg.includes("bans_one_active_permanent_per_scope")) {
      logger.info("ban.already_exists", { userId: data.userId, reasonCode: data.scope });
      return;
    }
    throw error;
  }
}
