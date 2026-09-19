import { describe, expect, it } from "vitest";
import { resolveActiveBusinessLanguages } from "./activeBusinessLanguages";

describe("active business languages", () => {
  it("defaults to English only when no language was configured", () => {
    expect(resolveActiveBusinessLanguages({})).toEqual({ mode: "single", primary: "en", secondary: null });
  });

  it("never adds Urdu in English-only mode", () => {
    expect(resolveActiveBusinessLanguages({ languageMode: "single", primaryLanguage: "en", secondaryLanguage: "ur" }))
      .toEqual({ mode: "single", primary: "en", secondary: null });
  });

  it("preserves the explicitly selected English and Arabic pair", () => {
    expect(resolveActiveBusinessLanguages({ languageMode: "bilingual", primaryLanguage: "en", secondaryLanguage: "ar" }))
      .toEqual({ mode: "bilingual", primary: "en", secondary: "ar" });
  });

  it("does not force English into an explicitly selected Urdu and Arabic pair", () => {
    expect(resolveActiveBusinessLanguages({ languageMode: "bilingual", primaryLanguage: "ur", secondaryLanguage: "ar" }))
      .toEqual({ mode: "bilingual", primary: "ur", secondary: "ar" });
  });

  it("does not claim unsupported language coverage", () => {
    expect(resolveActiveBusinessLanguages({ languageMode: "bilingual", primaryLanguage: "en", secondaryLanguage: "fr" }))
      .toEqual({ mode: "single", primary: "en", secondary: null });
  });

  it("rejects duplicate languages", () => {
    expect(resolveActiveBusinessLanguages({ languageMode: "bilingual", primaryLanguage: "ur", secondaryLanguage: "ur" }))
      .toEqual({ mode: "single", primary: "ur", secondary: null });
  });
});
