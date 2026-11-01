/**
 * Moderation label taxonomy.
 *
 * All classifiers must map their vendor-specific outputs to one of these canonical labels
 * before writing a `moderation_events` row. This ensures the policy engine and moderator
 * console speak a single language regardless of which provider produced the signal.
 *
 * Label hierarchy:
 *   csam                       → immediate escalation, no threshold review
 *   nudity_explicit            → very high confidence nudity
 *   nudity_partial             → suggestive but not explicit
 *   violence_graphic           → graphic violence
 *   violence_minor             → minor-in-distress signal
 *   minor_detected             → age estimator flagged possible minor
 *   hate_speech                → slurs, dehumanising language
 *   harassment                 → targeted personal attacks
 *   spam                       → commercial unsolicited messaging
 *   scam                       → fraud / phishing attempts
 *   self_harm                  → self-harm imagery or language
 *   drugs_weapons              → illegal items promotion
 *   pii_exposure               → credit cards, SSNs, phone numbers in chat
 *   safe                       → explicit clean classification
 */

export type ModerationLabel =
  | "csam"
  | "nudity_explicit"
  | "nudity_partial"
  | "violence_graphic"
  | "violence_minor"
  | "minor_detected"
  | "hate_speech"
  | "harassment"
  | "spam"
  | "scam"
  | "self_harm"
  | "drugs_weapons"
  | "pii_exposure"
  | "safe";

/**
 * Default policy thresholds per label.
 *
 * At launch these are conservative. They should be tuned against false-positive rates
 * from the first production week and tracked in `policy_version`.
 */
export const DEFAULT_THRESHOLDS: Record<ModerationLabel, number> = {
  csam: 0.5,             // fail closed — any doubt escalates
  nudity_explicit: 0.85,
  nudity_partial: 0.92,
  violence_graphic: 0.88,
  violence_minor: 0.80,
  minor_detected: 0.75,
  hate_speech: 0.88,
  harassment: 0.90,
  spam: 0.93,
  scam: 0.90,
  self_harm: 0.82,
  drugs_weapons: 0.90,
  pii_exposure: 0.88,
  safe: 1.0,
};

/** Whether a label triggers immediate escalation regardless of score. */
export function requiresImmediateEscalation(label: ModerationLabel): boolean {
  return label === "csam";
}

/** Whether a label score exceeds the configured threshold for automated action. */
export function exceedsThreshold(
  label: ModerationLabel,
  score: number,
  thresholds: Partial<Record<ModerationLabel, number>> = {},
): boolean {
  const threshold = thresholds[label] ?? DEFAULT_THRESHOLDS[label] ?? 1.0;
  return score >= threshold;
}

/**
 * Recommended automated action for a label at a given score.
 * Actions match the `action_taken` enum in `moderation_events`.
 */
export type ModerationAction =
  | "none"
  | "warn"
  | "blur"
  | "disconnect"
  | "restrict"
  | "temp_ban"
  | "permanent_ban"
  | "escalate";

export function recommendAction(
  label: ModerationLabel,
  score: number,
  thresholds: Partial<Record<ModerationLabel, number>> = {},
): ModerationAction {
  if (label === "csam") return "escalate";
  if (!exceedsThreshold(label, score, thresholds)) return "none";

  switch (label) {
    case "nudity_explicit":
    case "violence_graphic":
      return "disconnect";
    case "nudity_partial":
    case "violence_minor":
      return "warn";
    case "minor_detected":
      return "escalate";
    case "hate_speech":
    case "harassment":
      return "warn";
    case "spam":
    case "scam":
      return "restrict";
    case "self_harm":
      return "disconnect";
    case "drugs_weapons":
      return "restrict";
    case "pii_exposure":
      return "warn";
    default:
      return "none";
  }
}
