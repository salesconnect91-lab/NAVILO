export type LanguageMode = "single" | "bilingual";
export type RuntimeLanguageCode = "en" | "ur" | "ar" | "hi" | "bn" | "fa" | "tr" | "fr" | "es" | "de" | "pt" | "ru" | "zh" | "id" | "ms";

export type NaviloLanguage = {
  code: RuntimeLanguageCode;
  label: string;
  nativeLabel: string;
  direction: "ltr" | "rtl";
};

export type GlobalLanguage = NaviloLanguage & { status: "verified" | "requires_verification" };

/**
 * Pakistan release language catalog.
 * NAVILO is currently scoped to Pakistan, so only English and Urdu are
 * selectable/entitled languages. The broader RuntimeLanguageCode union is
 * retained for backward compatibility with historical stored data.
 */
export const NAVILO_LANGUAGES: NaviloLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", direction: "ltr" },
  { code: "ur", label: "Urdu", nativeLabel: "اردو", direction: "rtl" },
];

export const GLOBAL_LANGUAGE_CATALOG: GlobalLanguage[] = NAVILO_LANGUAGES.map((language) => ({
  ...language,
  status: "verified" as const,
}));

export const SUPPORTED_RUNTIME_LANGUAGE_CODES: RuntimeLanguageCode[] = NAVILO_LANGUAGES.map((language) => language.code);

export const SUPPORTED_BILINGUAL_PAIRS: ReadonlyArray<readonly [RuntimeLanguageCode, RuntimeLanguageCode]> = [
  ["en", "ur"],
  ["ur", "en"],
];

export const languageByCode = (code?: string | null) =>
  NAVILO_LANGUAGES.find((language) => language.code === code) ?? NAVILO_LANGUAGES[0];

export function isSupportedRuntimeLanguage(code?: string | null): code is RuntimeLanguageCode {
  return NAVILO_LANGUAGES.some((language) => language.code === code);
}

export function isAllowedBilingualPair(primary?: string | null, secondary?: string | null) {
  return Boolean(
    isSupportedRuntimeLanguage(primary) &&
      isSupportedRuntimeLanguage(secondary) &&
      primary !== secondary &&
      SUPPORTED_BILINGUAL_PAIRS.some(([a, b]) => a === primary && b === secondary),
  );
}

export function allowedSecondaryLanguages(primary: string) {
  return NAVILO_LANGUAGES.filter((language) => language.code !== primary);
}

export function normalizeRuntimeSelection(mode: LanguageMode, primary?: string | null, secondary?: string | null) {
  const safePrimary: RuntimeLanguageCode = isSupportedRuntimeLanguage(primary) ? primary : "en";
  if (mode !== "bilingual" || !isAllowedBilingualPair(safePrimary, secondary)) {
    return { mode: "single" as LanguageMode, primary: safePrimary, secondary: null as RuntimeLanguageCode | null };
  }
  return { mode: "bilingual" as LanguageMode, primary: safePrimary, secondary: secondary as RuntimeLanguageCode };
}

export function legacyPrintLanguage(
  mode: LanguageMode,
  primary: string,
  secondary?: string | null,
): "english" | "urdu" | "both" {
  if (mode === "bilingual" && new Set([primary, secondary]).has("en") && new Set([primary, secondary]).has("ur")) return "both";
  if (mode === "single" && primary === "ur") return "urdu";
  return "english";
}

export function languageDisplayLabel(code: string) {
  const language = NAVILO_LANGUAGES.find((item) => item.code === code) ?? NAVILO_LANGUAGES[0];
  return language.label === language.nativeLabel ? language.label : `${language.label} — ${language.nativeLabel}`;
}
