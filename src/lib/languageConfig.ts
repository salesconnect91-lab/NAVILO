export type LanguageMode = "single" | "bilingual";
export type RuntimeLanguageCode = "en" | "ur" | "ar";

export type NaviloLanguage = {
  code: RuntimeLanguageCode;
  label: string;
  nativeLabel: string;
  direction: "ltr" | "rtl";
};

export type GlobalLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
  direction: "ltr" | "rtl";
  status: "live" | "planned";
};

/** Languages currently translated and tested end-to-end in NAVILO. */
export const NAVILO_LANGUAGES: NaviloLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", direction: "ltr" },
  { code: "ur", label: "Urdu", nativeLabel: "اردو", direction: "rtl" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", direction: "rtl" },
];

/**
 * Commercial global-language catalogue. Planned languages are deliberately
 * visible to product/admin UX but are not selectable at runtime until their
 * complete UI + document dictionaries and layout QA are shipped.
 */
export const GLOBAL_LANGUAGE_CATALOG: GlobalLanguage[] = [
  ...NAVILO_LANGUAGES.map((language) => ({ ...language, status: "live" as const })),
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", direction: "ltr", status: "planned" },
  { code: "bn", label: "Bengali", nativeLabel: "বাংলা", direction: "ltr", status: "planned" },
  { code: "fa", label: "Persian", nativeLabel: "فارسی", direction: "rtl", status: "planned" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe", direction: "ltr", status: "planned" },
  { code: "fr", label: "French", nativeLabel: "Français", direction: "ltr", status: "planned" },
  { code: "es", label: "Spanish", nativeLabel: "Español", direction: "ltr", status: "planned" },
  { code: "de", label: "German", nativeLabel: "Deutsch", direction: "ltr", status: "planned" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", direction: "ltr", status: "planned" },
  { code: "ru", label: "Russian", nativeLabel: "Русский", direction: "ltr", status: "planned" },
  { code: "zh", label: "Chinese", nativeLabel: "中文", direction: "ltr", status: "planned" },
  { code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia", direction: "ltr", status: "planned" },
  { code: "ms", label: "Malay", nativeLabel: "Bahasa Melayu", direction: "ltr", status: "planned" },
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
  const language = GLOBAL_LANGUAGE_CATALOG.find((item) => item.code === code) ?? GLOBAL_LANGUAGE_CATALOG[0];
  return language.label === language.nativeLabel ? language.label : `${language.label} — ${language.nativeLabel}`;
}
