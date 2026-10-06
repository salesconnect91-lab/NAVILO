import { describe, expect, it } from "vitest";
import { FEATURE_BY_KEY, matchFeatureForPath } from "./featureRegistry";

describe("Transport Mobile feature governance", () => {
  it("registers independent mobile view/create/edit controls", () => {
    const feature=FEATURE_BY_KEY.get("transport-mobile-quick-entry");
    expect(feature?.route).toBe("/transport/mobile");
    expect(feature?.actions).toEqual(["view","create","edit"]);
    expect(feature?.businessUnitTypes).toEqual(["transport"]);
  });

  it("matches the dedicated mobile route before the generic Transport workspace", () => {
    expect(matchFeatureForPath("/transport/mobile")?.key).toBe("transport-mobile-quick-entry");
    expect(matchFeatureForPath("/transport/mobile/")?.key).toBe("transport-mobile-quick-entry");
  });
});
