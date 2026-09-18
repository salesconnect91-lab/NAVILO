import { describe, expect, it } from "vitest";
import { draftBusinessName, resolveBusinessNameDisplay } from "./businessNameLocale";

describe("business name locale isolation", () => {
  const names = { en: "Waseem", ur: "وسیم", ar: "وسيم" };

  it("shows only the explicitly selected secondary language", () => {
    expect(resolveBusinessNameDisplay(names, "en", "ar")).toEqual({
      primary: "Waseem", secondary: "وسيم", missingSecondary: false,
    });
  });

  it("never substitutes Urdu for an unavailable French name", () => {
    expect(resolveBusinessNameDisplay(names, "en", "fr")).toEqual({
      primary: "Waseem", secondary: null, missingSecondary: true,
    });
  });

  it("does not show an unselected second language in single mode", () => {
    expect(resolveBusinessNameDisplay(names, "en", null)).toEqual({
      primary: "Waseem", secondary: null, missingSecondary: false,
    });
  });

  it("preserves a manually approved spelling rather than regenerating it", () => {
    expect(draftBusinessName("Waseem", "ur", names)).toEqual({
      value: "وسیم", requiresReview: false, manualRequired: false,
    });
  });

  it("suggests the curated Waseem spelling for review", () => {
    expect(draftBusinessName("Waseem", "ur", { en: "Waseem" })).toEqual({
      value: "وسیم", requiresReview: true, manualRequired: false,
    });
  });

  it("requires manual entry rather than generating Urdu for Arabic", () => {
    expect(draftBusinessName("Waseem", "ar", { en: "Waseem" })).toEqual({
      value: "", requiresReview: false, manualRequired: true,
    });
  });
});
