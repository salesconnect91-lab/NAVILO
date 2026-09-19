import { resolveBusinessNameDisplay, type BusinessNameDisplay } from "@/lib/businessNameLocale";

/** Legacy name_urdu is Urdu data only. Never interpret it as Arabic or another locale. */
export type LegacyItemNames = Readonly<{ name: string; name_urdu?: string | null }>;

export function resolveLegacyItemNames(
  item: LegacyItemNames,
  mode: "single" | "bilingual",
  primaryLanguage: string,
  secondaryLanguage: string | null,
): BusinessNameDisplay {
  const names = { en: item.name, ur: item.name_urdu };
  return resolveBusinessNameDisplay(
    names,
    primaryLanguage,
    mode === "bilingual" ? secondaryLanguage : null,
  );
}

/** Never manufacture or overwrite a saved Urdu spelling during an unrelated item edit. */
export function preserveLegacyUrduName(
  previous: string | null | undefined,
  approvedUrduInput: string | null | undefined,
  editingUrdu: boolean,
): string | null {
  return editingUrdu ? approvedUrduInput?.trim() || null : previous ?? null;
}
