import { describe, expect, it } from "vitest";
import { employeeSecondaryName, preserveEmployeeUrduFields, suggestEmployeeName } from "./employeeLanguageFields";

const existing = {
  name_urdu: "وسیم",
  designation_urdu: "منیجر",
  department_urdu: "اکاؤنٹس",
};

describe("employee language isolation", () => {
  it("does not show legacy Urdu names in Arabic, Hindi or Chinese", () => {
    for (const language of ["ar", "hi", "zh"]) {
      expect(employeeSecondaryName(existing, "name_urdu", language)).toBeNull();
    }
    expect(employeeSecondaryName(existing, "name_urdu", "ur")).toBe("وسیم");
    expect(employeeSecondaryName(existing, "name_urdu", null)).toBeNull();
  });

  it("preserves approved Urdu values while editing in another language", () => {
    expect(preserveEmployeeUrduFields(existing, "ar", { name_urdu: "wrong" })).toEqual(existing);
    expect(preserveEmployeeUrduFields(existing, "hi", { department_urdu: "wrong" })).toEqual(existing);
  });

  it("does not overwrite an approved name with a blank input", () => {
    expect(preserveEmployeeUrduFields(existing, "ur", { name_urdu: " " })).toEqual(existing);
  });

  it("accepts explicitly reviewed Urdu fields without changing other fields", () => {
    expect(preserveEmployeeUrduFields(existing, "ur", { name_urdu: " وسیم احمد " })).toEqual({
      ...existing,
      name_urdu: "وسیم احمد",
    });
  });

  it("never invents Urdu for an Arabic name suggestion", () => {
    expect(suggestEmployeeName("Waseem", "ar")).toEqual({ status: "manual_required", language: "ar", value: null });
  });
});
