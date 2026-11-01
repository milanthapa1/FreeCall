/**
 * Matchmaking queue entry — the small JSON object stored per user in Redis.
 *
 * Stored in two places:
 *   mm:{region}:{lang}:{mode}:m  →  hash,  sid → entry json
 *   mm:{region}:{lang}:{mode}:q  →  zset,  sid, score = enqueued_at_ms - priority_boost_ms
 */
export interface QueueEntry {
  /** ISO 3166-1 alpha-2 country code, or "any" */
  c: string;
  /** ISO 639-1 primary language code */
  l: string;
  /** Trust band numeric: low=0, normal=1, high=2 */
  b: number;
  /** Age tier string */
  t: string;
  /** Own gender (optional, used for preference matching) */
  g?: string;
  /** Strict gender preference: true = only match opposite gender */
  sg?: boolean;
  /** Priority boost in ms (subtracted from score so lower score = earlier in queue) */
  p: number;
}

export const TRUST_BAND_NUM: Record<string, number> = {
  low: 0,
  normal: 1,
  high: 2,
};

/** Build queue keys for a given region/lang/mode combo. */
export function queueKeys(region: string, lang: string, mode: string) {
  const base = `mm:{${region}}:${lang}:${mode}`;
  return {
    /** Sorted set: sid → score (enqueued_at - priority_boost) */
    q: `${base}:q`,
    /** Hash: sid → entry JSON */
    m: `${base}:m`,
  } as const;
}

/** Exclusion key for a given region + sid. */
export function exclusionKey(region: string, sid: string): string {
  return `mm:{${region}}:ex:${sid}`;
}

/** Claim key for a given region + sid. */
export function claimKey(region: string, sid: string): string {
  return `mm:{${region}}:claim:${sid}`;
}

/** Presence key for a given sid (global, not region-sharded). */
export function presenceKey(sid: string): string {
  return `presence:${sid}`;
}

/** Guest daily cap key. */
export function guestCapKey(userId: string, date: string): string {
  return `cap:${userId}:${date}`;
}

/** Ban key. */
export function banKey(userId: string): string {
  return `ban:${userId}`;
}

/** Serialize a QueueEntry to the compact JSON format stored in Redis. */
export function serializeEntry(entry: QueueEntry): string {
  return JSON.stringify(entry);
}

/** Parse a QueueEntry from the compact JSON string stored in Redis. */
export function parseEntry(raw: string): QueueEntry {
  return JSON.parse(raw) as QueueEntry;
}

/**
 * Widening steps for matchmaking.
 * Each step specifies which queue keys to try, in order.
 * The Lua script tries queues left-to-right and stops at the first match.
 */
export interface WideningStep {
  stepIndex: number;
  delayMs: number;
  description: string;
  /**
   * Build the ordered list of queue zset keys to probe for a given user.
   * More specific queues come first.
   */
  buildKeys: (opts: {
    region: string;
    lang: string;
    mode: string;
    neighbourRegions?: readonly string[];
  }) => string[];
}

export const WIDENING_STEPS: readonly WideningStep[] = [
  {
    stepIndex: 0,
    delayMs: 0,
    description: "exact: region + language + mode",
    buildKeys: ({ region, lang, mode }) => [queueKeys(region, lang, mode).q],
  },
  {
    stepIndex: 1,
    delayMs: 5_000,
    description: "relax language (use 'any' lang bucket if available)",
    buildKeys: ({ region, lang, mode }) => {
      const keys: string[] = [queueKeys(region, lang, mode).q];
      if (lang !== "en") {
        keys.push(queueKeys(region, "en", mode).q);
      }
      keys.push(queueKeys(region, "any", mode).q);
      return [...new Set(keys)];
    },
  },
  {
    stepIndex: 2,
    delayMs: 10_000,
    description: "relax region (try neighbour regions)",
    buildKeys: ({ region, lang, mode, neighbourRegions = [] }) => {
      const keys: string[] = [
        queueKeys(region, lang, mode).q,
        queueKeys(region, "any", mode).q,
      ];
      for (const nr of neighbourRegions) {
        keys.push(queueKeys(nr, lang, mode).q);
        keys.push(queueKeys(nr, "any", mode).q);
      }
      return [...new Set(keys)];
    },
  },
  {
    stepIndex: 3,
    delayMs: 20_000,
    description: "relax mode (solo may match couple if both opted in)",
    buildKeys: ({ region, lang, mode, neighbourRegions = [] }) => {
      const modes = mode === "solo" ? ["solo", "couple"] : ["couple", "solo"];
      const keys: string[] = [];
      for (const m of modes) {
        keys.push(queueKeys(region, lang, m).q);
        keys.push(queueKeys(region, "any", m).q);
      }
      for (const nr of neighbourRegions) {
        for (const m of modes) {
          keys.push(queueKeys(nr, lang, m).q);
          keys.push(queueKeys(nr, "any", m).q);
        }
      }
      return [...new Set(keys)];
    },
  },
] as const;

/** Total time before giving up (45 s). */
export const MATCH_GIVE_UP_MS = 45_000;
/** Max probes per Lua invocation. */
export const MAX_PROBES = 50;
/** Cooldown after matching with a user before matching again (30 min). */
export const COOLDOWN_SEC = 1800;
/** Presence key TTL in seconds. */
export const PRESENCE_TTL_SEC = 15;
/** Connect deadline: both clients must send `joined` within this window. */
export const CONNECT_DEADLINE_MS = 8_000;
/** Disconnect grace before sending partner_left. */
export const DISCONNECT_GRACE_MS = 5_000;
/** Reconnect window after disconnect. */
export const RECONNECT_WINDOW_MS = 10_000;
