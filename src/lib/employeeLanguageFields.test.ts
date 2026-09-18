import { describe, expect, it } from "vitest";
import { employeeSecondaryName, mergeReviewedEmployeeImport, prepareEmployeeUrduImport, preserveEmployeeUrduFields, suggestEmployeeName } from "./employeeLanguageFields";

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

  it("drops Urdu-only import columns for English-only, Arabic and Hindi selections", () => {
    for (const language of [null, "en", "ar", "hi"]) {
      expect(prepareEmployeeUrduImport(existing, language)).toEqual({
        name_urdu: null, designation_urdu: null, department_urdu: null,
      });
    }
  });

  it("keeps only explicitly imported, trimmed Urdu fields in Urdu mode", () => {
    expect(prepareEmployeeUrduImport({ name_urdu: " وسیم ", designation_urdu: " " }, "ur")).toEqual({
      name_urdu: "وسیم", designation_urdu: null, department_urdu: null,
    });
  });

  it("preserves historical Urdu during an Arabic or Hindi import", () => {
    for (const language of ["ar", "hi", "en", null]) {
      expect(mergeReviewedEmployeeImport(existing, { name_urdu: "غلط" }, language)).toEqual(existing);
    }
  });

  it("merges reviewed Urdu imports without erasing untouched or blank fields", () => {
    expect(mergeReviewedEmployeeImport(existing, { name_urdu: " وسیم احمد ", designation_urdu: " " }, "ur")).toEqual({
      ...existing,
      name_urdu: "وسیم احمد",
    });
  });

  it("does not generate a translation for a new employee without reviewed input", () => {
    expect(mergeReviewedEmployeeImport(null, {}, "ur")).toEqual({
      name_urdu: null, designation_urdu: null, department_urdu: null,
    });
  });
});
