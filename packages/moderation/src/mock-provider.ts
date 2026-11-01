/**
 * Mock moderation provider for local development and tests.
 *
 * Always returns `safe` with score 0.01 so local runs never trigger automated actions.
 * In CI tests, specific helpers allow injecting a response via `MockModerationProvider.inject()`.
 */

import type {
  ClassificationResult,
  FrameClassificationInput,
  ModerationProvider,
  TextClassificationInput,
} from "./provider.js";

export class MockModerationProvider implements ModerationProvider {
  readonly name = "mock";

  private injectedFrame: ClassificationResult[] | null = null;
  private injectedText: ClassificationResult[] | null = null;

  /** Inject a one-shot frame response for the next classifyFrame call. */
  injectFrame(results: ClassificationResult[]): void {
    this.injectedFrame = results;
  }

  /** Inject a one-shot text response for the next classifyText call. */
  injectText(results: ClassificationResult[]): void {
    this.injectedText = results;
  }

  async classifyFrame(_input: FrameClassificationInput): Promise<ClassificationResult[]> {
    if (this.injectedFrame !== null) {
      const r = this.injectedFrame;
      this.injectedFrame = null;
      return r;
    }
    return safeResult();
  }

  async classifyText(_input: TextClassificationInput): Promise<ClassificationResult[]> {
    if (this.injectedText !== null) {
      const r = this.injectedText;
      this.injectedText = null;
      return r;
    }
    return safeResult();
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

function safeResult(): ClassificationResult[] {
  return [
    {
      label: "safe",
      score: 0.01,
      raw: { mock: true },
      model: "mock",
      modelVersion: "0.0.0",
    },
  ];
}
