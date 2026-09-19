import { describe, expect, it } from "vitest";
import { selectDocumentLanguages } from "./documentLanguageSelection";

const supported = ["en", "ur", "ar"] as const;

describe("catalog-gated document language selection", () => {
  it("allows two verified non-English languages without adding English", () => {
    expect(selectDocumentLanguages("bilingual", "ur", "ar", supported, "en")).toEqual({
      mode: "bilingual", primary: "ur", secondary: "ar",
    });
  });

  it("does not activate a language without verified translations", () => {
    expect(selectDocumentLanguages("bilingual", "en", "fr", supported, "en")).toEqual({
      mode: "single", primary: "en", secondary: null,
    });
  });

  it("never adds a second language in single mode or duplicates a language", () => {
    expect(selectDocumentLanguages("single", "ur", "ar", supported, "en")).toEqual({
      mode: "single", primary: "ur", secondary: null,
    });
    expect(selectDocumentLanguages("bilingual", "ar", "ar", supported, "en")).toEqual({
      mode: "single", primary: "ar", secondary: null,
    });
  });

  it("supports a new language only when its translations are registered", () => {
    expect(selectDocumentLanguages("bilingual", "fr", "de", ["en", "fr", "de"] as const, "en")).toEqual({
      mode: "bilingual", primary: "fr", secondary: "de",
    });
  });

  it("rejects an unsupported fallback rather than silently inventing translations", () => {
    expect(() => selectDocumentLanguages("single", "fr", null, supported, "fr" as (typeof supported)[number])).toThrow(
      "Document language fallback must have verified translations",
    );
  });
});
