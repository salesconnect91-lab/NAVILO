import { suggestBusinessNameConversion } from "@/lib/nameConversion";

/** A name belongs to a stable business record, not to a language-specific record. */
export type LocalizedBusinessNames = Readonly<Record<string, string | null | undefined>>;

export type BusinessNameDisplay = {
  primary: string;
  secondary: string | null;
  missingSecondary: boolean;
};

/**
 * Display only names explicitly saved for the selected languages. Never display
 * name_urdu (or another language) as an implicit fallback for a missing locale.
 * Existing legacy Urdu values may be supplied by the caller under the `ur` key.
 */
export function resolveBusinessNameDisplay(
  names: LocalizedBusinessNames,
  primaryLanguage: string,
  secondaryLanguage: string | null,
): BusinessNameDisplay {
  const primary = names[primaryLanguage]?.trim() || names.en?.trim() || "";
  const secondary = secondaryLanguage && secondaryLanguage !== primaryLanguage
    ? names[secondaryLanguage]?.trim() || null
    : null;
  return {
    primary,
    secondary,
    missingSecondary: Boolean(secondaryLanguage && secondaryLanguage !== primaryLanguage && !secondary),
  };
}

/**
 * Generate a draft only for the explicitly requested language. A saved, approved
 * spelling always wins; suggestions must be reviewed before they are persisted.
 */
export function draftBusinessName(
  englishName: string,
  language: string,
  approvedNames: LocalizedBusinessNames,
): { value: string; requiresReview: boolean; manualRequired: boolean } {
  const approved = approvedNames[language]?.trim();
  if (approved) return { value: approved, requiresReview: false, manualRequired: false };
  const suggestion = suggestBusinessNameConversion(englishName, language);
  if (suggestion.status === "manual_required") {
    return { value: "", requiresReview: false, manualRequired: true };
  }
  return { value: suggestion.value, requiresReview: true, manualRequired: false };
}
