import { SUPPORTED_LOCALES, type SupportedLocale } from "./types.js";

/**
 * Negotiates a supported locale from an Accept-Language header string.
 * Falls back to "en" if no match is found.
 */
export function negotiateLocale(header: string | null | undefined, defaultLocale: SupportedLocale = "en"): SupportedLocale {
  if (!header || typeof header !== "string") {
    return defaultLocale;
  }

  const entries = header
    .split(",")
    .map((part) => {
      const parts = part.trim().split(";q=");
      const tag = parts[0]?.trim() ?? "";
      const qValue = parts[1];
      const q = qValue !== undefined ? parseFloat(qValue) : 1.0;
      return { tag, q: isNaN(q) ? 0 : q };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    const rawTag = entry.tag.toLowerCase();
    
    // Direct full match (e.g. pt-br -> pt-BR)
    for (const code of Object.keys(SUPPORTED_LOCALES) as SupportedLocale[]) {
      if (code.toLowerCase() === rawTag) {
        return code;
      }
    }

    // Language prefix match (e.g. "es-MX" -> "es", "ar-SA" -> "ar")
    const primary = rawTag.split("-")[0];
    for (const code of Object.keys(SUPPORTED_LOCALES) as SupportedLocale[]) {
      if (code.toLowerCase() === primary || code.toLowerCase().startsWith(primary + "-")) {
        return code;
      }
    }
  }

  return defaultLocale;
}
