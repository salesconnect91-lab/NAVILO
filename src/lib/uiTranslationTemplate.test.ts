import { describe, expect, it } from "vitest";
import { translateUiTemplate } from "./uiTranslationTemplate";

describe("UI translation templates", () => {
  it("preserves dates and numbers in English", () => {
    expect(
      translateUiTemplate("{count} posted document(s) · {period}", {
        count: 12,
        period: "2026-09-01 → 2026-09-19",
      }, "en"),
    ).toBe("12 posted document(s) · 2026-09-01 → 2026-09-19");
  });

  it("translates Urdu text while preserving the date", () => {
    expect(
      translateUiTemplate("Posted A/R balance as of {date}", {
        date: "2026-09-19",
      }, "ur"),
    ).toBe("2026-09-19 تک پوسٹ شدہ قابلِ وصول بیلنس");
  });
});
