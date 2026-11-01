/** Wire protocol version. Breaking changes bump this; `v-1` is supported for 30 days. */
export const PROTOCOL_VERSION = 1 as const;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

/** Hard limits enforced in the transport before allocation, not after parsing. */
export const LIMITS = {
  maxFrameBytes: 16 * 1024,
  maxChatChars: 500,
  maxTranslatedChatChars: 2_000,
  maxReportNoteChars: 500,
  maxReportMessages: 50,
  maxReportPayloadBytes: 16 * 1024,
  maxClientEventsPerSecond: 8,
  maxClientEventBurst: 20,
  maxChatPerSecond: 1,
  maxTypingPerSecond: 1,
  maxSkipPerSecond: 1,
  maxEnqueuePerSecond: 1,
  maxSdpChars: 8_192,
  maxIceCandidateChars: 2_048,
  maxNoteChars: 2_000,
} as const;

export const CLOSE_CODES = {
  idleTimeout: 4000,
  unauthorized: 4001,
  unsupportedVersion: 4002,
  banned: 4003,
  sessionReplaced: 4004,
  protocolViolation: 4005,
  repeatedInvalidFrames: 4006,
  draining: 4007,
} as const;

export const RATE_LIMITS = {
  eventsPerSecond: LIMITS.maxClientEventsPerSecond,
  eventBurst: LIMITS.maxClientEventBurst,
  chatPerSecond: LIMITS.maxChatPerSecond,
  typingPerSecond: LIMITS.maxTypingPerSecond,
  skipCooldownMs: 2_000,
  enqueueCooldownMs: 3_000,
  maxInvalidFrames: 5,
  invalidFrameWindowMs: 60_000,
} as const;
