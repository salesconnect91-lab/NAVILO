import { describe, expect, it } from "vitest";
import { GLOBAL_UI_TRANSLATIONS, translateGlobalUi } from "./globalTranslations";

describe("global UI translation", () => {
  it("does not partially translate an unknown phrase", () => {
    expect(translateGlobalUi("Posted A", "ur")).toBe("Posted A");
  });

  it("translates a complete known phrase", () => {
    expect(translateGlobalUi("Posted", "ur")).toBe(GLOBAL_UI_TRANSLATIONS.Posted.ur);
  });

  it("translates the newly added Dashboard labels into Urdu", () => {
    expect(translateGlobalUi("Business Overview", "ur")).toBe("کاروباری جائزہ");
    expect(translateGlobalUi("Purchases", "ur")).toBe("خریداری");
    expect(translateGlobalUi("Receivables", "ur")).toBe("قابلِ وصول رقوم");
    expect(translateGlobalUi("Payables", "ur")).toBe("قابلِ ادا رقوم");
    expect(translateGlobalUi("Cash Balance", "ur")).toBe("نقد رقم کا بیلنس");
    expect(translateGlobalUi("Bank Balance", "ur")).toBe("بینک بیلنس");
    expect(translateGlobalUi("Inventory Value", "ur")).toBe("اسٹاک کی مالیت");
    expect(translateGlobalUi("No activity", "ur")).toBe("کوئی سرگرمی نہیں");
  });
});
