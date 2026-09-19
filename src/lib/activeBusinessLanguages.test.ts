import { describe, expect, it } from "vitest";
import { resolveActiveBusinessLanguages, VERIFIED_BUSINESS_LANGUAGES } from "./activeBusinessLanguages";

describe("active business languages", () => {
  it("exposes only Pakistan's verified English and Urdu languages", () => {
    expect(VERIFIED_BUSINESS_LANGUAGES).toEqual(["en", "ur"]);
  });

  it("defaults to English only when no language was configured", () => {
    expect(resolveActiveBusinessLanguages({})).toEqual({ mode: "single", primary: "en", secondary: null });
  });

  it("never adds Urdu in English-only mode", () => {
    expect(
      resolveActiveBusinessLanguages({
        languageMode: "single",
        primaryLanguage: "en",
        secondaryLanguage: "ur",
      }),
    ).toEqual({ mode: "single", primary: "en", secondary: null });
  });

  it("allows the Pakistan English and Urdu bilingual pair", () => {
    expect(
      resolveActiveBusinessLanguages({
        languageMode: "bilingual",
        primaryLanguage: "en",
        secondaryLanguage: "ur",
      }),
    ).toEqual({ mode: "bilingual", primary: "en", secondary: "ur" });
  });

  it("does not force English into an explicitly selected Urdu and English pair", () => {
    expect(
      resolveActiveBusinessLanguages({
        languageMode: "bilingual",
        primaryLanguage: "ur",
        secondaryLanguage: "en",
      }),
    ).toEqual({ mode: "bilingual", primary: "ur", secondary: "en" });
  });

  it("rejects non-Pakistan languages", () => {
    expect(
      resolveActiveBusinessLanguages({
        languageMode: "bilingual",
        primaryLanguage: "en",
        secondaryLanguage: "ar",
      }),
    ).toEqual({ mode: "single", primary: "en", secondary: null });
  });

  it("rejects duplicate languages", () => {
    expect(
      resolveActiveBusinessLanguages({
        languageMode: "bilingual",
        primaryLanguage: "ur",
        secondaryLanguage: "ur",
      }),
    ).toEqual({ mode: "single", primary: "ur", secondary: null });
  });
});
