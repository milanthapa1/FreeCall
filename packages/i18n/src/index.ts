import { ar } from "./locales/ar.js";
import { en } from "./locales/en.js";
import { es } from "./locales/es.js";
import { hi } from "./locales/hi.js";
import { ptBR } from "./locales/pt-BR.js";
import type { LocaleMessages, SupportedLocale } from "./types.js";

export * from "./types.js";
export * from "./negotiate.js";

export const translations: Record<SupportedLocale, LocaleMessages> = {
  en,
  es,
  "pt-BR": ptBR,
  hi,
  ar,
};

export function getTranslations(locale: SupportedLocale = "en"): LocaleMessages {
  return translations[locale] ?? translations.en;
}
