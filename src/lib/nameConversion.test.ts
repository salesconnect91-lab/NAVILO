import { describe, expect, it } from "vitest";
import { suggestBusinessNameConversion } from "./nameConversion";

describe("business name conversion", () => {
  it("suggests the approved Urdu spelling for Waseem", () => {
    expect(suggestBusinessNameConversion("Waseem", "ur")).toEqual({ status: "suggested", language: "ur", value: "وسیم" });
  });

  it("preserves approved spelling inside a compound business name", () => {
    expect(suggestBusinessNameConversion("Waseem Steel", "ur")).toEqual({ status: "suggested", language: "ur", value: "وسیم اسٹیل" });
  });

  it("never substitutes Urdu when Arabic, French or Hindi was selected", () => {
    for (const language of ["ar", "fr", "hi"]) {
      expect(suggestBusinessNameConversion("Waseem", language)).toEqual({ status: "manual_required", language, value: null });
    }
  });

  it("does not invent a secondary name in English-only mode", () => {
    expect(suggestBusinessNameConversion("Waseem", "en")).toEqual({ status: "manual_required", language: "en", value: null });
  });

  it("requires manual review for existing Urdu, Arabic, Hindi and mixed-script names", () => {
    for (const name of ["وسیم", "وسيم", "वसीम", "Waseem وسیم"]) {
      expect(suggestBusinessNameConversion(name, "ur")).toEqual({ status: "manual_required", language: "ur", value: null });
    }
  });
});
