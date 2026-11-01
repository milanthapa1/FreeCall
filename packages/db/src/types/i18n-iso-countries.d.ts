declare module "i18n-iso-countries" {
  interface CountriesApi {
    registerLocale(locale: unknown): void;
    getAlpha2Codes(): Record<string, string>;
    getName(code: string, language: string): string | undefined;
  }

  const countries: CountriesApi;
  export default countries;
}
