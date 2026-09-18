import { selectDocumentLanguages, type LanguageSelection } from "@/lib/documentLanguageSelection";

export const VERIFIED_BUSINESS_LANGUAGES = ["en", "ur", "ar"] as const;
export type VerifiedBusinessLanguage = (typeof VERIFIED_BUSINESS_LANGUAGES)[number];

/** Read the same document language selection used by the application shell.
 * Unsupported locales must not be silently treated as Urdu or as translated.
 * Add a locale to VERIFIED_BUSINESS_LANGUAGES only after its document labels and
 * business-name entry/display flows have been verified end to end.
 */
export function resolveActiveBusinessLanguages(
  dataset: Readonly<{ languageMode?: string; primaryLanguage?: string; secondaryLanguage?: string }>,
): LanguageSelection<VerifiedBusinessLanguage> {
  return selectDocumentLanguages(
    dataset.languageMode,
    dataset.primaryLanguage,
    dataset.secondaryLanguage,
    VERIFIED_BUSINESS_LANGUAGES,
    "en",
  );
}
