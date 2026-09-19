import { toUrduName } from "@/lib/urdu";

/** Business names are transliterated, never translated as UI labels. */
export type NameConversionResult =
  | { status: "suggested"; language: string; value: string }
  | { status: "manual_required"; language: string; value: null };

const APPROVED_URDU_NAMES: Readonly<Record<string, string>> = {
  waseem: "وسیم",
};

/**
 * A suggestion is only available for an explicitly supported converter.
 * Never silently replace an unavailable language with Urdu or English.
 * The caller must let the user review/edit the suggestion before saving it.
 */
export function suggestBusinessNameConversion(name: string, language: string): NameConversionResult {
  const source = name.trim();
  if (!source || !language || language === "en") {
    return { status: "manual_required", language, value: null };
  }
  if (language === "ur") {
    // Existing non-Latin names may already be approved Urdu, Arabic, Hindi or
    // another script. Do not pass them through a Latin-to-Urdu converter.
    // Mixed-script names also need a human review rather than a destructive guess.
    if (/[^\u0000-\u007f]/u.test(source)) {
      return { status: "manual_required", language, value: null };
    }
    // Apply curated spellings to individual names too: "Waseem Steel" must not
    // bypass the Waseem override simply because it is part of a longer name.
    const value = source.split(/(\s+)/).map((part) =>
      /^\s+$/.test(part) ? part : APPROVED_URDU_NAMES[part.toLowerCase()] ?? toUrduName(part),
    ).join("");
    return { status: "suggested", language, value };
  }
  return { status: "manual_required", language, value: null };
}
