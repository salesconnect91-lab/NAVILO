import { describe, expect, it } from "vitest";
import { normalizeDocumentLanguages, renderDocumentLabel } from "./documentI18n";

describe("worldwide document language requirements", () => {
  it.fails("allows an explicitly selected Urdu and Arabic pair without requiring English", () => {
    expect(normalizeDocumentLanguages("bilingual", "ur", "ar")).toEqual({
      mode: "bilingual", primary: "ur", secondary: "ar",
    });
    expect(renderDocumentLabel("Invoice", "bilingual", "ur", "ar")).toBe("انوائس / الفاتورة");
  });

  it.fails("accepts a future language only when its translations are available", () => {
    // French is a representative locale; enabling its code without translations
    // would incorrectly display untranslated English as if it were French.
    expect(normalizeDocumentLanguages("single", "fr", null).primary).toBe("fr");
    expect(renderDocumentLabel("Invoice", "single", "fr", null)).toBe("Facture");
  });
});
