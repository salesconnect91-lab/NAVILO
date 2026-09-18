import { suggestBusinessNameConversion } from "@/lib/nameConversion";

/** Legacy employee columns contain Urdu only, never Arabic, Hindi or other locales. */
export type EmployeeUrduFields = {
  name_urdu: string | null;
  designation_urdu: string | null;
  department_urdu: string | null;
};

export type EmployeeEnglishFields = {
  name: string;
  designation: string | null;
  department: string | null;
};

export function suggestEmployeeName(name: string, selectedLanguage: string) {
  return suggestBusinessNameConversion(name, selectedLanguage);
}

/** An empty form value must not erase an existing approved translation. */
export function preserveEmployeeUrduFields(
  existing: EmployeeUrduFields | null,
  selectedLanguage: string,
  approved: Partial<EmployeeUrduFields> = {},
): EmployeeUrduFields {
  const previous: EmployeeUrduFields = existing ?? {
    name_urdu: null,
    designation_urdu: null,
    department_urdu: null,
  };
  if (selectedLanguage !== "ur") return { ...previous };
  return {
    name_urdu: approved.name_urdu?.trim() || previous.name_urdu,
    designation_urdu: approved.designation_urdu?.trim() || previous.designation_urdu,
    department_urdu: approved.department_urdu?.trim() || previous.department_urdu,
  };
}

/** Merge reviewed import values with existing records without erasing translations.
 * Import callers must match records by a stable identifier before passing existing.
 * No conversion is performed implicitly: suggestions require explicit approval. */
export function mergeReviewedEmployeeImport(
  existing: EmployeeUrduFields | null,
  imported: Partial<EmployeeUrduFields>,
  selectedLanguage: string | null,
): EmployeeUrduFields {
  if (selectedLanguage !== "ur") return preserveEmployeeUrduFields(existing, "en");
  return preserveEmployeeUrduFields(existing, "ur", prepareEmployeeUrduImport(imported, "ur"));
}

/** Import columns are Urdu-specific. Never generate Urdu from English or persist
 * imported Urdu columns while the workspace uses another secondary language.
 * The import preview must require review before calling this function. */
export function prepareEmployeeUrduImport(
  imported: Partial<EmployeeUrduFields>,
  selectedLanguage: string | null,
): EmployeeUrduFields {
  if (selectedLanguage !== "ur") {
    return { name_urdu: null, designation_urdu: null, department_urdu: null };
  }
  return {
    name_urdu: imported.name_urdu?.trim() || null,
    designation_urdu: imported.designation_urdu?.trim() || null,
    department_urdu: imported.department_urdu?.trim() || null,
  };
}

/** No Urdu value is substituted for Arabic, Hindi, Chinese or other locales. */
export function employeeSecondaryName(
  employee: EmployeeUrduFields,
  field: keyof EmployeeUrduFields,
  selectedLanguage: string | null,
): string | null {
  return selectedLanguage === "ur" ? employee[field] : null;
}
