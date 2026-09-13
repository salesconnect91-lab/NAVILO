export type LanguageMode = "single" | "bilingual";
export type RuntimeLanguageCode = "en" | "ur" | "ar";

export type NaviloLanguage = {
  code: RuntimeLanguageCode;
  label: string;
  nativeLabel: string;
  direction: "ltr" | "rtl";
};

/**
 * Languages that NAVILO can currently translate end-to-end at runtime.
 * Add a language here only after its UI/document translation dictionaries
 * and RTL/LTR behaviour are fully implemented and tested.
 */
export const NAVILO_LANGUAGES: NaviloLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", direction: "ltr" },
  { code: "ur", label: "Urdu", nativeLabel: "اردو", direction: "rtl" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", direction: "rtl" },
];

export const SUPPORTED_RUNTIME_LANGUAGE_CODES: RuntimeLanguageCode[] = NAVILO_LANGUAGES.map((language) => language.code);
export const SUPPORTED_BILINGUAL_PAIRS: ReadonlyArray<readonly [RuntimeLanguageCode, RuntimeLanguageCode]> = [
  ["en", "ur"],
  ["en", "ar"],
];

export const languageByCode = (code?: string | null) => NAVILO_LANGUAGES.find((language) => language.code === code) ?? NAVILO_LANGUAGES[0];

export function isSupportedRuntimeLanguage(code?: string | null): code is RuntimeLanguageCode {
  return code === "en" || code === "ur" || code === "ar";
}

export function isAllowedBilingualPair(primary?: string | null, secondary?: string | null) {
  if (!isSupportedRuntimeLanguage(primary) || !isSupportedRuntimeLanguage(secondary) || primary === secondary) return false;
  const pair = new Set([primary, secondary]);
  return pair.has("en") && (pair.has("ur") || pair.has("ar"));
}

export function allowedSecondaryLanguages(primary: string) {
  if (primary === "en") return NAVILO_LANGUAGES.filter((language) => language.code === "ur" || language.code === "ar");
  if (primary === "ur" || primary === "ar") return NAVILO_LANGUAGES.filter((language) => language.code === "en");
  return NAVILO_LANGUAGES.filter((language) => language.code !== primary);
}

export function normalizeRuntimeSelection(mode: LanguageMode, primary?: string | null, secondary?: string | null) {
  const safePrimary: RuntimeLanguageCode = isSupportedRuntimeLanguage(primary) ? primary : "en";
  if (mode !== "bilingual" || !isAllowedBilingualPair(safePrimary, secondary)) {
    return { mode: "single" as LanguageMode, primary: safePrimary, secondary: null as RuntimeLanguageCode | null };
  }
  return { mode: "bilingual" as LanguageMode, primary: safePrimary, secondary: secondary as RuntimeLanguageCode };
}

export function legacyPrintLanguage(mode: LanguageMode, primary: string, secondary?: string | null): "english" | "urdu" | "both" {
  if (mode === "bilingual" && new Set([primary, secondary]).has("en") && new Set([primary, secondary]).has("ur")) return "both";
  if (mode === "single" && primary === "ur") return "urdu";
  return "english";
}

export function languageDisplayLabel(code: string) {
  const language = languageByCode(code);
  return language.label === language.nativeLabel ? language.label : `${language.label} — ${language.nativeLabel}`;
}
