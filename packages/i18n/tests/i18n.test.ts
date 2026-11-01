import { describe, expect, it } from "vitest";
import { getTranslations, negotiateLocale, SUPPORTED_LOCALES, translations } from "../src/index.js";
import type { SupportedLocale } from "../src/types.js";

describe("i18n package", () => {
  it("provides complete translations for all supported locales without missing keys", () => {
    const requiredKeys: (keyof typeof translations.en)[] = [
      "common",
      "landing",
      "ageGate",
      "rulesOverlay",
      "permissions",
      "blockedMarket",
    ];

    for (const locale of Object.keys(SUPPORTED_LOCALES) as SupportedLocale[]) {
      const messages = getTranslations(locale);
      for (const section of requiredKeys) {
        expect(messages[section]).toBeDefined();
        for (const [_key, value] of Object.entries(messages[section])) {
          expect(typeof value).toBe("string");
          expect(value.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("sets correct RTL direction for Arabic", () => {
    expect(SUPPORTED_LOCALES.ar.dir).toBe("rtl");
    expect(SUPPORTED_LOCALES.en.dir).toBe("ltr");
    expect(SUPPORTED_LOCALES.es.dir).toBe("ltr");
  });

  it("negotiates locales from Accept-Language headers", () => {
    expect(negotiateLocale("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
    expect(negotiateLocale("pt-BR,pt;q=0.9")).toBe("pt-BR");
    expect(negotiateLocale("hi-IN,hi;q=0.9")).toBe("hi");
    expect(negotiateLocale("ar-EG,ar;q=0.9")).toBe("ar");
    expect(negotiateLocale("fr-FR,fr;q=0.9")).toBe("en"); // fallback
    expect(negotiateLocale("")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
  });
});
