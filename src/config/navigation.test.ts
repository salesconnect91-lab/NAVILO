import { describe, expect, it } from "vitest";
import { flatten, filterNode, navigation } from "./navigation";
import { defaultRolePermissions } from "@/auth/permissions";

function visibleNavigation(role: string, modules: string[], unitType?: string, enabled = true) {
  return navigation
    .map((node) => filterNode(node, role, false, modules, unitType, defaultRolePermissions(role), (key) => key !== "purchase-invoices" || enabled))
    .filter(Boolean)
    .flatMap((node) => flatten([node!]));
}

describe("sidebar module links", () => {
  it("shows Purchase Expense Invoice links to purchase users with create access", () => {
    const links = visibleNavigation("purchase", ["purchase", "master"]);
    expect(links.some((node) => node.to === "/purchase/expense/new")).toBe(true);
    expect(links.some((node) => node.to === "/purchase/expense/import")).toBe(true);
  });

  it("hides expense invoice shortcuts when the purchase feature is disabled", () => {
    const links = visibleNavigation("purchase", ["purchase"], undefined, false);
    expect(links.some((node) => node.key === "expense-invoice-create")).toBe(false);
    expect(links.some((node) => node.key === "expense-invoice-import")).toBe(false);
  });

  it("shows transport expense tools only in transport business units", () => {
    const transport = visibleNavigation("transport", ["transport", "accounting", "master"], "transport");
    const steel = visibleNavigation("admin", ["transport", "accounting", "master"], "steel");
    expect(transport.some((node) => node.key === "vehicle-expenses")).toBe(true);
    expect(transport.some((node) => node.key === "vehicle-expense-types")).toBe(true);
    expect(steel.some((node) => node.key === "vehicle-expenses")).toBe(false);
    expect(steel.some((node) => node.key === "vehicle-expense-types")).toBe(false);
  });
});
