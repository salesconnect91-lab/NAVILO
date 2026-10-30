import { describe, expect, it } from "vitest";
import { canTransportAction, defaultRolePermissions, hasPermission, mergePermissions, type PermissionMatrix } from "./permissions";

describe("ERP permission model", () => {
  it("allows every active company role to use all Transport actions", () => {
    expect(canTransportAction("transport",{},"rent_finalize")).toBe(true);
    expect(canTransportAction("admin",{},"rent_finalize")).toBe(true);
    expect(canTransportAction("admin",{transport_actions:{rent_finalize:false}},"rent_finalize")).toBe(false);
    expect(canTransportAction("transport",{transport_actions:{rent_finalize:true}},"rent_finalize")).toBe(true);
  });
  it("keeps company admins fully privileged", () => {
    expect(hasPermission("admin", "accounting", "post")).toBe(true);
    expect(hasPermission("company_owner", "settings", "delete")).toBe(true);
  });

  it("allows operational roles to edit and delete in all modules", () => {
    expect(hasPermission("sales", "sales", "delete")).toBe(true);
    expect(hasPermission("purchase", "purchase", "delete")).toBe(true);
    expect(hasPermission("store", "inventory", "delete")).toBe(true);
  });

  it("allows viewer role to use every module action", () => {
    expect(hasPermission("viewer", "reports", "view")).toBe(true);
    expect(hasPermission("viewer", "reports", "print")).toBe(true);
    expect(hasPermission("viewer", "sales", "view")).toBe(true);
    expect(hasPermission("viewer", "reports", "create")).toBe(true);
  });

  it("does not let stale permission overrides re-lock actions", () => {
    const override: PermissionMatrix = {
      sales: { view: false, create: false, edit: false, delete: false, post: false, print: false },
    };
    const merged = mergePermissions(defaultRolePermissions("sales"), override);
    expect(merged.sales?.view).toBe(true);
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

  it("removes Transport Mobile Only action restrictions for active members", () => {
    const permissions=defaultRolePermissions("transport_mobile");
    expect(permissions.transport?.view).toBe(true);
    expect(permissions.transport?.create).toBe(true);
    expect(permissions.transport?.edit).toBe(true);
    expect(permissions.transport?.post).toBe(true);
    expect(permissions.dashboard?.view).toBe(true);
    expect(permissions.reports?.view).toBe(true);
    expect(permissions.transport_actions?.trip_create).toBe(true);
    expect(permissions.transport_actions?.trip_edit).toBe(true);
  });

  it("removes read-only and custom-deny permission restrictions", () => {
    for (const action of ["create","edit","delete","post"] as const) expect(hasPermission("viewer","reports",action)).toBe(true);
    expect(hasPermission("accounts","accounting","post",{accounting:{post:false}})).toBe(true);
    expect(hasPermission("viewer","sales","view",{sales:{view:false}})).toBe(true);
  });
});
