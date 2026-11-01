import { z } from "zod";

export const uuid = z.uuid();
export const iso2 = z.string().length(2).regex(/^[A-Z]{2}$/, "must be an ISO 3166-1 alpha-2 code");
export const lang = z.string().length(2).regex(/^[a-z]{2}$/, "must be an ISO 639-1 code");
export const locale = z.string().min(2).max(16);

export const callId = uuid;
export const messageId = uuid;
export const userId = uuid;
export const sessionId = uuid;

export const mode = z.enum(["solo", "couple"]);
export type Mode = z.infer<typeof mode>;

export const gender = z.enum(["m", "f", "x"]);
export type Gender = z.infer<typeof gender>;

export const trustBand = z.enum(["low", "normal", "high"]);
export type TrustBand = z.infer<typeof trustBand>;

export const ageTier = z.enum(["t0_declared", "t1_estimated", "t2_verified", "t3_locked"]);
export type AgeTier = z.infer<typeof ageTier>;

export const countryPreference = z.union([z.literal("any"), iso2]);
export type CountryPreference = z.infer<typeof countryPreference>;

export const platform = z.enum(["web", "ios", "android"]);
export type Platform = z.infer<typeof platform>;

export const reportReason = z.enum([
  "nudity",
  "minor",
  "violence",
  "harassment",
  "spam",
  "scam",
  "ncii",
  "other",
]);
export type ReportReason = z.infer<typeof reportReason>;

export const banScope = z.enum(["call", "dm", "upload", "platform"]);
export type BanScope = z.infer<typeof banScope>;

export const endReason = z.enum([
  "skip",
  "stop",
  "disconnect",
  "setup_timeout",
  "enforcement",
  "error",
  "partner_left",
]);
export type EndReason = z.infer<typeof endReason>;
