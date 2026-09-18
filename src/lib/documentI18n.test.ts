import { describe, expect, it } from "vitest";
import { isKnownDocumentLabel, normalizeDocumentLanguages, renderDocumentLabel } from "./documentI18n";

describe("document language isolation", () => {
  it("renders English alone when bilingual mode is not enabled", () => {
    expect(normalizeDocumentLanguages("single", "en", "ur")).toEqual({ mode: "single", primary: "en", secondary: null });
    expect(renderDocumentLabel("Invoice", "single", "en", "ur")).toBe("Invoice");
    expect(renderDocumentLabel("Grand Total", "single", "en", "ur")).toBe("Grand Total");
  });

  it("shows both languages only for an explicitly selected bilingual pair", () => {
    expect(normalizeDocumentLanguages("bilingual", "en", "ur")).toEqual({ mode: "bilingual", primary: "en", secondary: "ur" });
    expect(renderDocumentLabel("Invoice", "bilingual", "en", "ur")).toBe("Invoice / انوائس");
    expect(renderDocumentLabel("Invoice", "bilingual", "en", "en")).toBe("Invoice");
  });

  it("preserves document field values while translating known labels", () => {
    expect(isKnownDocumentLabel("Invoice No: INV-2026-001")).toBe(true);
    expect(renderDocumentLabel("Invoice No: INV-2026-001", "single", "ur", null)).toBe("انوائس نمبر: INV-2026-001");
    expect(renderDocumentLabel("Customer: 2026 Trading Company", "single", "en", "ur")).toBe("Customer: 2026 Trading Company");
  });

  it("does not enable an unrequested language when configuration is invalid", () => {
    expect(normalizeDocumentLanguages("bilingual", "en", "en")).toEqual({ mode: "single", primary: "en", secondary: null });
    expect(normalizeDocumentLanguages("bilingual", "en", "unknown")).toEqual({ mode: "single", primary: "en", secondary: null });
    expect(normalizeDocumentLanguages("single", "unknown", "ur")).toEqual({ mode: "single", primary: "en", secondary: null });
  });

  it("keeps customer values and invoice identifiers intact in bilingual labels", () => {
    expect(renderDocumentLabel("Customer: 2026 Trading Company", "bilingual", "en", "ur")).toBe("Customer / گاہک: 2026 Trading Company");
    expect(renderDocumentLabel("Invoice No: INV-2026-001", "bilingual", "en", "ar")).toBe("Invoice No / رقم الفاتورة: INV-2026-001");
  });
});
