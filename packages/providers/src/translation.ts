/**
 * Translation provider abstraction.
 *
 * Used for per-message translation toggle in the call UI.
 * Concrete adapters implement `TranslationProvider` and are injected by the worker.
 */

export interface TranslationResult {
  translatedText: string;
  detectedSourceLang: string;
  targetLang: string;
  provider: string;
}

export type TranslationOutcome =
  | { ok: true; result: TranslationResult }
  | { ok: false; reason: "unsupported_lang" | "provider_error" | "timeout" };

export interface TranslationProvider {
  name: string;

  translate(opts: {
    text: string;
    targetLang: string;
    sourceLang?: string;
  }): Promise<TranslationOutcome>;

  ping(): Promise<boolean>;
}

/** Identity translation provider: returns the input unchanged. Used in tests. */
export class NoopTranslationProvider implements TranslationProvider {
  readonly name = "noop";

  async translate(opts: {
    text: string;
    targetLang: string;
    sourceLang?: string;
  }): Promise<TranslationOutcome> {
    return {
      ok: true,
      result: {
        translatedText: opts.text,
        detectedSourceLang: opts.sourceLang ?? "en",
        targetLang: opts.targetLang,
        provider: "noop",
      },
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
