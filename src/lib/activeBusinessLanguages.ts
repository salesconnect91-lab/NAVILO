import { selectDocumentLanguages, type LanguageSelection } from "@/lib/documentLanguageSelection";

/**
 * Pakistan release language policy.
 * Only English and Urdu have been verified and are selectable for this release.
 */
export const VERIFIED_BUSINESS_LANGUAGES = ["en", "ur"] as const;
export type VerifiedBusinessLanguage = (typeof VERIFIED_BUSINESS_LANGUAGES)[number];

/** Resolve the same language selection used by the application shell. */
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
