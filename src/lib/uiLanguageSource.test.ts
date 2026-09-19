import { describe, expect, it } from "vitest";
import { sourceEnglish } from "./uiLanguageSource";

describe("UI language source", () => {
  it("preserves accounting abbreviations containing slashes", () => {
    expect(sourceEnglish("Posted A/R balance")).toBe("Posted A/R balance");
    expect(sourceEnglish("Posted A/P balance")).toBe("Posted A/P balance");
  });

  it("extracts English from bilingual text", () => {
    expect(sourceEnglish("ڈیش بورڈ / Dashboard")).toBe("Dashboard");
    expect(sourceEnglish("Dashboard / ڈیش بورڈ")).toBe("Dashboard");
  });
});
