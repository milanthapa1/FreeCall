export { Matcher } from "./matcher.js";
export {
  COOLDOWN_SEC,
  CONNECT_DEADLINE_MS,
  DISCONNECT_GRACE_MS,
  MATCH_GIVE_UP_MS,
  MAX_PROBES,
  PRESENCE_TTL_SEC,
  RECONNECT_WINDOW_MS,
  TRUST_BAND_NUM,
  WIDENING_STEPS,
  banKey,
  claimKey,
  exclusionKey,
  guestCapKey,
  parseEntry,
  presenceKey,
  queueKeys,
  serializeEntry,
  type QueueEntry,
  type WideningStep,
} from "./queue.js";
export type { MatchResult, MatchUser, MatcherCallbacks } from "./matcher.js";
