import { suggestBusinessNameConversion } from "@/lib/nameConversion";

/** Existing employee columns are Urdu-only. Never store another language in them. */
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

/** A suggestion is never persisted until the user explicitly accepts or edits it. */
export function suggestEmployeeName(name: string, selectedLanguage: string) {
  return suggestBusinessNameConversion(name, selectedLanguage);
}

/**
 * Preserve legacy Urdu data when editing an employee in another language.
 * Blank inputs do not erase an approved translation; a deliberate clearing
 * operation must be implemented separately with an explicit user action.
 */
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

/** No Urdu value is substituted for Arabic, Hindi, Chinese or other locales. */
export function employeeSecondaryName(
  employee: EmployeeUrduFields,
  field: keyof EmployeeUrduFields,
  selectedLanguage: string | null,
): string | null {
  return selectedLanguage === "ur" ? employee[field] : null;
}
