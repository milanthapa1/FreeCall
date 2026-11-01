/**
 * Matcher — Redis-backed matchmaking engine.
 *
 * Wraps the pop_pair Lua script and manages the widening schedule.
 * Each SocketSession calls enqueueUser() and then receives match results
 * via the onMatched callback.
 */
import type { Logger } from "@freecall/observability";
import type { AgeTier, Mode, TrustBand } from "@freecall/protocol";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Redis from "ioredis";
import {
  COOLDOWN_SEC,
  MATCH_GIVE_UP_MS,
  MAX_PROBES,
  PRESENCE_TTL_SEC,
  TRUST_BAND_NUM,
  WIDENING_STEPS,
  banKey,
  claimKey,
  exclusionKey,
  parseEntry,
  presenceKey,
  queueKeys,
  serializeEntry,
  type QueueEntry,
} from "./queue.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUA_SCRIPT = readFileSync(join(__dirname, "pop-pair.lua"), "utf8");

export interface MatchUser {
  sid: string;
  userId: string;
  region: string;
  country: string;
  lang: string;
  mode: Mode;
  ageTier: AgeTier;
  trustBand: TrustBand;
  ownGender?: string;
  /** If true, only match with the opposite gender (m↔f). */
  strictGender: boolean;
  enqueuedAt: number;
  priorityBoostMs: number;
  neighbourRegions?: readonly string[];
}

export interface MatchResult {
  callId: string;
  peerSid: string;
  peerEntry: QueueEntry;
  matchedAt: number;
  queueKey: string;
}

export interface MatcherCallbacks {
  onMatched: (user: MatchUser, result: MatchResult) => Promise<void>;
  onNoMatch: (user: MatchUser) => void;
}

interface EnqueuedState {
  user: MatchUser;
  callbacks: MatcherCallbacks;
  wideningTimers: ReturnType<typeof setTimeout>[];
  active: boolean;
}

export class Matcher {
  private readonly redis: Redis;
  private readonly logger: Logger;
  private scriptSha: string | null = null;
  /** In-flight enqueue states keyed by sid. */
  private readonly enqueued = new Map<string, EnqueuedState>();

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis;
    this.logger = logger;
  }

  /** Load the Lua script into Redis at startup. */
  async loadScript(): Promise<void> {
    this.scriptSha = await redisScriptLoad(this.redis, LUA_SCRIPT);
    this.logger.info("matcher.script.loaded", { reasonCode: 'script_loaded' });
  }

  /**
   * Enqueue a user for matchmaking.
   * Starts the widening schedule; calls `callbacks.onMatched` exactly once on success,
   * or `callbacks.onNoMatch` if no partner found within the give-up window.
   */
  async enqueueUser(user: MatchUser, callbacks: MatcherCallbacks): Promise<void> {
    if (this.enqueued.has(user.sid)) {
      this.logger.warn("matcher.enqueue.already_enqueued", { sessionId: user.sid });
      return;
    }

    // Safety gate: refuse locked accounts.
    if (user.ageTier === "t3_locked") {
      callbacks.onNoMatch(user);
      return;
    }

    // Check ban key.
    const banned = await this.redis.exists(banKey(user.userId));
    if (banned) {
      this.logger.info("matcher.enqueue.banned", { userId: user.userId });
      callbacks.onNoMatch(user);
      return;
    }

    const state: EnqueuedState = {
      user,
      callbacks,
      wideningTimers: [],
      active: true,
    };
    this.enqueued.set(user.sid, state);

    // Write entry to queue.
    await this.writeQueueEntry(user);

    // Run immediate match attempt (step 0).
    await this.tryMatch(user.sid, 0);

    if (!state.active) return; // matched or dequeued already

    // Schedule widening steps.
    for (const step of WIDENING_STEPS) {
      if (step.delayMs === 0) continue; // already ran
      const timer = setTimeout(async () => {
        if (!state.active) return;
        await this.tryMatch(user.sid, step.stepIndex);
      }, step.delayMs);
      timer.unref?.();
      state.wideningTimers.push(timer);
    }

    // Schedule give-up.
    const giveUpTimer = setTimeout(() => {
      if (!state.active) return;
      this.logger.info("matcher.enqueue.give_up", { sessionId: user.sid });
      this.dequeueUser(user.sid);
      callbacks.onNoMatch(user);
    }, MATCH_GIVE_UP_MS);
    giveUpTimer.unref?.();
    state.wideningTimers.push(giveUpTimer);
  }

  /** Remove a user from the queue (skip, stop, disconnect, dequeue). */
  async dequeueUser(sid: string): Promise<void> {
    const state = this.enqueued.get(sid);
    if (!state) return;

    state.active = false;
    for (const t of state.wideningTimers) clearTimeout(t);
    state.wideningTimers.length = 0;
    this.enqueued.delete(sid);

    // Remove from all possible queue buckets.
    await this.removeFromQueues(state.user);
  }

  /** Check if a user is currently in the queue. */
  isEnqueued(sid: string): boolean {
    return this.enqueued.has(sid);
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private async writeQueueEntry(user: MatchUser): Promise<void> {
    const entry: QueueEntry = {
      c: user.country,
      l: user.lang,
      b: TRUST_BAND_NUM[user.trustBand] ?? 1,
      t: user.ageTier,
      g: user.ownGender,
      sg: user.strictGender || undefined, // omit when false to save bytes
      p: user.priorityBoostMs,
    };
    const entryJson = serializeEntry(entry);
    const { q, m } = queueKeys(user.region, user.lang, user.mode);
    const score = user.enqueuedAt - user.priorityBoostMs;

    const pipeline = this.redis.pipeline();
    pipeline.zadd(q, score, user.sid);
    pipeline.hset(m, user.sid, entryJson);
    pipeline.set(presenceKey(user.sid), "1", "EX", PRESENCE_TTL_SEC);
    await pipeline.exec();
  }

  private async removeFromQueues(user: MatchUser): Promise<void> {
    // Remove from the primary queue bucket. Widened buckets don't store entries there
    // (entries are only written to one bucket; widening only reads from extra buckets).
    const { q, m } = queueKeys(user.region, user.lang, user.mode);
    await this.redis.pipeline().zrem(q, user.sid).hdel(m, user.sid).exec();
  }

  private async tryMatch(sid: string, stepIndex: number): Promise<void> {
    const state = this.enqueued.get(sid);
    if (!state || !state.active) return;

    const { user } = state;
    const step = WIDENING_STEPS[stepIndex] ?? WIDENING_STEPS[0];
    if (!step) return;
    const now = Date.now();

    const queueKeyList = step.buildKeys({
      region: user.region,
      lang: user.lang,
      mode: user.mode,
      neighbourRegions: user.neighbourRegions,
    });

    const exKey = exclusionKey(user.region, sid);
    const ckKey = claimKey(user.region, sid);

    // Build KEYS array: queue keys + ex key + claim key
    const keys = [...queueKeyList, exKey, ckKey];

    const entry: QueueEntry = {
      c: user.country,
      l: user.lang,
      b: TRUST_BAND_NUM[user.trustBand] ?? 1,
      t: user.ageTier,
      g: user.ownGender,
      sg: user.strictGender || undefined,
      p: user.priorityBoostMs,
    };
    const entryJson = serializeEntry(entry);
    const bandNum = TRUST_BAND_NUM[user.trustBand] ?? 1;

    const args = [
      sid,
      String(now),
      entryJson,
      String(MAX_PROBES),
      String(COOLDOWN_SEC),
      String(bandNum),
      String(queueKeyList.length),
      user.strictGender ? "1" : "0",
    ];

    let rawResult: string;
    try {
      rawResult = await this.evalScript(keys, args);
    } catch (err) {
      this.logger.error("matcher.evalsha.error", { sessionId: sid, errorMessage: String(err) });
      return;
    }

    let result: PopPairResult;
    try {
      result = JSON.parse(rawResult) as PopPairResult;
    } catch {
      this.logger.error("matcher.evalsha.bad_response", { sessionId: sid, errorMessage: rawResult });
      return;
    }

    if (result.status === "wait") {
      this.logger.debug("matcher.match.wait", { sessionId: sid, stepIndex, probes: result.probes });
      return;
    }

    if (result.status === "already_claimed") {
      this.logger.debug("matcher.match.already_claimed", { sessionId: sid });
      return;
    }

    if (result.status === "matched") {
      const peerSid = result.a === sid ? result.b : result.a;
      const peerEntryRaw = result.a === sid ? result.b_entry : result.a_entry;

      // Mark both sides as dequeued.
      const myState = this.enqueued.get(sid);
      const peerState = this.enqueued.get(peerSid);

      if (myState) {
        myState.active = false;
        for (const t of myState.wideningTimers) clearTimeout(t);
        myState.wideningTimers.length = 0;
        this.enqueued.delete(sid);
      }
      if (peerState) {
        peerState.active = false;
        for (const t of peerState.wideningTimers) clearTimeout(t);
        peerState.wideningTimers.length = 0;
        this.enqueued.delete(peerSid);
      }

      const matchResult: MatchResult = {
        callId: result.matched_at.toString(), // placeholder; real callId assigned in session
        peerSid,
        peerEntry: parseEntry(JSON.stringify(peerEntryRaw)),
        matchedAt: result.matched_at,
        queueKey: result.queue_key,
      };

      this.logger.info("matcher.match.found", {
        sessionId: sid,
        peerSessionId: peerSid,
        stepIndex,
        queueKey: result.queue_key,
      });

      // Notify both sides.
      await state.callbacks.onMatched(user, matchResult);
      if (peerState) {
        const peerMatchResult: MatchResult = {
          ...matchResult,
          peerSid: sid,
          peerEntry: entry,
        };
        await peerState.callbacks.onMatched(peerState.user, peerMatchResult);
      }
    }
  }

  private async evalScript(keys: string[], args: string[]): Promise<string> {
    if (this.scriptSha !== null) {
      try {
        const result = await (this.redis as unknown as RedisEvalsha).evalsha(
          this.scriptSha,
          keys.length,
          ...keys,
          ...args,
        );
        return result as string;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("NOSCRIPT")) throw err;
        // Script was flushed; reload and retry with EVAL.
        this.scriptSha = await redisScriptLoad(this.redis, LUA_SCRIPT);
      }
    }
    // Fallback: EVAL
    const result = await (this.redis as unknown as RedisEval).eval(
      LUA_SCRIPT,
      keys.length,
      ...keys,
      ...args,
    );
    return result as string;
  }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface PopPairWait {
  status: "wait";
  probes: number;
}

interface PopPairClaimed {
  status: "already_claimed";
}

interface PopPairMatched {
  status: "matched";
  a: string;
  b: string;
  a_entry: unknown;
  b_entry: unknown;
  queue_key: string;
  matched_at: number;
}

type PopPairResult = PopPairWait | PopPairClaimed | PopPairMatched;

// Minimal ioredis method signatures for evalsha/eval with spread args.
interface RedisEvalsha {
  evalsha(sha: string, numkeys: number, ...keysAndArgs: string[]): Promise<unknown>;
}

interface RedisEval {
  eval(script: string, numkeys: number, ...keysAndArgs: string[]): Promise<unknown>;
}


// Type-safe wrapper for redis.script("load", ...) which ioredis types poorly.
async function redisScriptLoad(redis: Redis, script: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (redis as any).script("load", script) as Promise<string>;
}
