import { describe, expect, it } from "vitest";
import { availableChargeKey, chargeWriteError, makeChargeKey, overlappingCharge } from "./chargeMasterKeys";
const records = [
  { id: "sales-id", charge_key: "cancellation_charegs", charge_name: "Cancellation Charegs", applies_to: "sales" as const },
  { id: "purchase-id", charge_key: "cancellation_charges", charge_name: "Cancellation Charges", applies_to: "purchase" as const },
];
describe("Charge Master stable keys and independent Sales/Purchase names", () => {
  it("does not treat a Sales rename as a conflicting Purchase charge", () => {
    expect(overlappingCharge(records, "Cancellation Charges", "sales", "sales-id")).toBeUndefined();
    expect(records[0].charge_key).toBe("cancellation_charegs");
  });
  it("creates a scoped Sales key where Purchase owns the original key", () => {
    expect(availableChargeKey("Cancellation Charges", "sales", records)).toBe("cancellation_charges_sales");
  });
  it("allows opposite-side names, but disallows overlapping scopes", () => {
    expect(overlappingCharge(records, "Cancellation Charges", "sales")).toBeUndefined();
    expect(overlappingCharge(records, " Cancellation Charges ", "purchase")?.id).toBe("purchase-id");
    expect(overlappingCharge([...records, { id:"b",charge_key:"wait",charge_name:"Waiting",applies_to:"both" as const }],"Waiting","sales")?.id).toBe("b");
  });
  it("supports an Excel batch containing one charge per side", () => {
    const staged = [{ id:"s",charge_key:"waiting_charges",charge_name:"Waiting Charges",applies_to:"sales" as const }];
    expect(availableChargeKey("Waiting Charges","purchase",staged)).toBe("waiting_charges_purchase");
    expect(makeChargeKey("Waiting Charges")).toBe("waiting_charges");
  });
  it("converts SQL 409 to an actionable message", () => {
    expect(chargeWriteError({code:"23505",message:'duplicate key violates ux_charge_master_company_key'})).toContain("Refresh Charge Master");
    expect(chargeWriteError({code:"23503",message:"foreign key violation"})).toBe("foreign key violation");
  });
});
