import { describe, expect, it } from "vitest";
import { defaultRolePermissions, hasPermission, mergePermissions, type PermissionMatrix } from "./permissions";

describe("ERP permission model", () => {
  it("keeps company admins fully privileged", () => {
    expect(hasPermission("admin", "accounting", "post")).toBe(true);
    expect(hasPermission("company_owner", "settings", "delete")).toBe(true);
  });

  it("prevents operational roles from deleting by default", () => {
    expect(hasPermission("sales", "sales", "delete")).toBe(false);
    expect(hasPermission("purchase", "purchase", "delete")).toBe(false);
    expect(hasPermission("store", "inventory", "delete")).toBe(false);
  });

  it("limits viewers to read/print reporting", () => {
    expect(hasPermission("viewer", "reports", "view")).toBe(true);
    expect(hasPermission("viewer", "reports", "print")).toBe(true);
    expect(hasPermission("viewer", "sales", "view")).toBe(false);
    expect(hasPermission("viewer", "reports", "create")).toBe(false);
  });

  it("honors explicit company-user overrides", () => {
    const override: PermissionMatrix = {
      sales: { view: false, create: false, edit: false, delete: false, post: false, print: false },
    };
    const merged = mergePermissions(defaultRolePermissions("sales"), override);
    expect(merged.sales?.view).toBe(false);
    expect(merged.reports?.view).toBe(true);
  });

  it("gives every supported company role dashboard access", () => {
    for (const role of ["company_owner","admin","accounts","sales","purchase","store","production","transport","viewer"]) {
      expect(hasPermission(role,"dashboard","view"),role).toBe(true);
    }
  });

  it("keeps each operational role inside its write module", () => {
    const assignments = {
      accounts:"accounting",sales:"sales",purchase:"purchase",store:"inventory",production:"production",transport:"transport",
    } as const;
    for (const [role,module] of Object.entries(assignments)) {
      expect(hasPermission(role,module,"create"),`${role} create ${module}`).toBe(true);
      expect(hasPermission(role,module,"edit"),`${role} edit ${module}`).toBe(true);
      expect(hasPermission(role,module,"post"),`${role} post ${module}`).toBe(true);
      expect(hasPermission(role,module,"delete"),`${role} delete ${module}`).toBe(false);
    }
  });

  it("keeps viewers read-only and custom denies authoritative", () => {
    for (const action of ["create","edit","delete","post"] as const) expect(hasPermission("viewer","reports",action)).toBe(false);
    expect(hasPermission("accounts","accounting","post",{accounting:{post:false}})).toBe(false);
    expect(hasPermission("viewer","sales","view",{sales:{view:true}})).toBe(true);
  });
});
