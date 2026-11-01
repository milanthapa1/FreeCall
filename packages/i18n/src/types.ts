export interface LocaleMessages {
  common: {
    brandName: string;
    adultsOnly: string;
    startChat: string;
    stopChat: string;
    skip: string;
    connecting: string;
    loading: string;
    error: string;
    retry: string;
    close: string;
  };
  landing: {
    heroTitle: string;
    heroSubtitle: string;
    startButton: string;
    onlineCount: string;
    rulesNotice: string;
    privacyNotice: string;
    termsNotice: string;
  };
  ageGate: {
    title: string;
    description: string;
    dobLabel: string;
    attestationCheckbox: string;
    submitButton: string;
    underageError: string;
    providerAssurancePrompt: string;
    providerAssuranceButton: string;
  };
  rulesOverlay: {
    title: string;
    faceRequired: string;
    noNudity: string;
    noScreensOrText: string;
    noHarassment: string;
    agreeCheckbox: string;
    confirmButton: string;
  };
  permissions: {
    title: string;
    description: string;
    requestButton: string;
    deniedTitle: string;
    deniedMessage: string;
    noDevicesTitle: string;
    noDevicesMessage: string;
    audioFallbackButton: string;
  };
  blockedMarket: {
    title: string;
    message: string;
    legalReason: string;
  };
}

export type SupportedLocale = "en" | "es" | "pt-BR" | "hi" | "ar";

export interface LocaleMeta {
  code: SupportedLocale;
  name: string;
  dir: "ltr" | "rtl";
}

export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleMeta> = {
  en: { code: "en", name: "English", dir: "ltr" },
  es: { code: "es", name: "Español", dir: "ltr" },
  "pt-BR": { code: "pt-BR", name: "Português (Brasil)", dir: "ltr" },
  hi: { code: "hi", name: "हिन्दी", dir: "ltr" },
  ar: { code: "ar", name: "العربية", dir: "rtl" },
};
