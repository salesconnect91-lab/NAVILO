import { describe, expect, it } from "vitest";
import { preserveLegacyUrduName, resolveLegacyItemNames } from "./itemNameLanguage";

describe("legacy item name language isolation", () => {
  const item = { name: "Waseem", name_urdu: "وسیم" };

  it("shows saved Urdu only when Urdu is selected", () => {
    expect(resolveLegacyItemNames(item, "bilingual", "en", "ur")).toEqual({
      primary: "Waseem", secondary: "وسیم", missingSecondary: false,
    });
  });

  it("does not mislabel Urdu as Arabic", () => {
    expect(resolveLegacyItemNames(item, "bilingual", "en", "ar")).toEqual({
      primary: "Waseem", secondary: null, missingSecondary: true,
    });
  });

  it("does not show Urdu in English-only mode", () => {
    expect(resolveLegacyItemNames(item, "single", "en", "ur").secondary).toBeNull();
  });

  it("preserves approved Urdu on unrelated edits", () => {
    expect(preserveLegacyUrduName("وسیم", undefined, false)).toBe("وسیم");
    expect(preserveLegacyUrduName(null, undefined, false)).toBeNull();
  });

  it("changes Urdu only on an explicit approved edit", () => {
    expect(preserveLegacyUrduName("واسیم", " وسیم ", true)).toBe("وسیم");
  });
});
