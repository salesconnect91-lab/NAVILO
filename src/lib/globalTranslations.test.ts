import { describe, expect, it } from "vitest";
import { GLOBAL_UI_TRANSLATIONS, translateGlobalUi } from "./globalTranslations";

describe("global UI translation", () => {
  it("does not partially translate an unknown phrase", () => {
    expect(translateGlobalUi("Posted A", "ur")).toBe("Posted A");
  });

  it("translates a complete known phrase", () => {
    expect(translateGlobalUi("Posted", "ur")).toBe(GLOBAL_UI_TRANSLATIONS.Posted.ur);
  });
});
