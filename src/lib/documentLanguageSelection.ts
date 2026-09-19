export type LanguageSelectionMode = "single" | "bilingual";

export type LanguageSelection<Code extends string> = {
  mode: LanguageSelectionMode;
  primary: Code;
  secondary: Code | null;
};

/** Only languages with verified translations may be enabled. Country codes are not language codes. */
export function selectDocumentLanguages<Code extends string>(
  mode: string | null | undefined,
  primary: string | null | undefined,
  secondary: string | null | undefined,
  supported: readonly Code[],
  fallback: Code,
): LanguageSelection<Code> {
  if (!supported.includes(fallback)) {
    throw new Error("Document language fallback must have verified translations");
  }

  const selectedPrimary = supported.find((code) => code === primary) ?? fallback;
  const selectedSecondary = supported.find((code) => code === secondary) ?? null;

  if (mode !== "bilingual" || !selectedSecondary || selectedSecondary === selectedPrimary) {
    return { mode: "single", primary: selectedPrimary, secondary: null };
  }

  return { mode: "bilingual", primary: selectedPrimary, secondary: selectedSecondary };
}
