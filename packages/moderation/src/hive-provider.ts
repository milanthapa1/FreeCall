/**
 * Hive Moderation provider adapter.
 *
 * https://thehive.ai/docs/video-moderation
 *
 * Maps Hive's taxonomy to the canonical labels. Only the categories relevant to
 * freecall's policy are mapped; unknown categories are silently ignored.
 */

import type {
  ClassificationResult,
  FrameClassificationInput,
  ModerationProvider,
  TextClassificationInput,
} from "./provider.js";
import type { ModerationLabel } from "./labels.js";

interface HiveClass {
  class: string;
  score: number;
}

interface HiveFrameResponse {
  status: { code: number };
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: Array<{ classes: HiveClass[]; time?: any }>;
}

const HIVE_TO_LABEL: Record<string, ModerationLabel> = {
  yes_sexual_activity: "nudity_explicit",
  yes_nudity: "nudity_explicit",
  suggestive: "nudity_partial",
  yes_graphic_violence: "violence_graphic",
  yes_self_harm: "self_harm",
  hate_speech: "hate_speech",
  spam: "spam",
};

const HIVE_FRAME_URL = "https://api.thehive.ai/api/v2/task/async/image_moderation";
const HIVE_TEXT_URL = "https://api.thehive.ai/api/v2/task/async/text_moderation";
const TIMEOUT_MS = 8_000;
const MODEL = "hive";
const MODEL_VERSION = "v2";

export class HiveModerationProvider implements ModerationProvider {
  readonly name = "hive";

  constructor(private readonly apiKey: string) {}

  async classifyFrame(input: FrameClassificationInput): Promise<ClassificationResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(HIVE_FRAME_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `token ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image: { format: "base64", content: input.imageBase64 } }),
      });

      if (!res.ok) {
        throw new Error(`Hive frame API returned ${res.status}`);
      }

      const json = (await res.json()) as HiveFrameResponse;
      const classes = json.output?.[0]?.classes ?? [];
      return mapHiveClasses(classes);
    } finally {
      clearTimeout(timer);
    }
  }

  async classifyText(input: TextClassificationInput): Promise<ClassificationResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(HIVE_TEXT_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `token ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text_data: input.text }),
      });

      if (!res.ok) {
        throw new Error(`Hive text API returned ${res.status}`);
      }

      const json = (await res.json()) as HiveFrameResponse;
      const classes = json.output?.[0]?.classes ?? [];
      return mapHiveClasses(classes);
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch("https://api.thehive.ai/", {
        signal: controller.signal,
        method: "GET",
      });
      return res.ok || res.status === 401;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapHiveClasses(classes: HiveClass[]): ClassificationResult[] {
  const results: ClassificationResult[] = [];

  for (const cls of classes) {
    const label = HIVE_TO_LABEL[cls.class];
    if (label !== undefined) {
      results.push({
        label,
        score: cls.score,
        raw: cls,
        model: MODEL,
        modelVersion: MODEL_VERSION,
      });
    }
  }

  // Always include a safe result so callers can inspect the highest non-safe score.
  if (results.length === 0) {
    results.push({ label: "safe", score: 1.0, raw: classes, model: MODEL, modelVersion: MODEL_VERSION });
  }

  return results.sort((a, b) => b.score - a.score);
}
