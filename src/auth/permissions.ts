export type CompanyRole =
  | "company_owner"
  | "admin"
  | "accounts"
  | "sales"
  | "purchase"
  | "store"
  | "production"
  | "transport"
  | "viewer"
  | string;

export type ModuleKey =
  | "dashboard"
  | "master"
  | "sales"
  | "purchase"
  | "inventory"
  | "production"
  | "transport"
  | "accounting"
  | "reports"
  | "settings";

export type ModuleAction = "view" | "create" | "edit" | "delete" | "post" | "print" | "export";
export type ModulePermissionSet = Record<ModuleAction, boolean>;
export type PermissionMatrix = Partial<Record<ModuleKey, Partial<ModulePermissionSet>>> & {
  transport_actions?: Partial<Record<TransportAction, boolean>>;
};

export type TransportAction = "customer_finance_view" | "supplier_finance_view" | "trip_create" | "trip_edit" | "trip_cancel" | "trip_delete" |
  "customer_rate_finalize" | "customer_rate_override" | "rent_finalize" | "rent_correct" |
  "vehicle_owner_change" | "assignment_replace" | "ppr_receive" | "master_manage" | "number_config" |
  "settlement_post" | "settlement_unpost" | "billing_adjust" | "payment_correct" |
  "driver_month_close" | "driver_month_reopen";

export function canTransportAction(role: CompanyRole | null | undefined,
  permissions: Record<string, unknown> | null | undefined, action: TransportAction, isPlatformOwner = false) {
  if (isPlatformOwner) return true;
  const override = (permissions?.transport_actions as Record<string, unknown> | undefined)?.[action];
  if (typeof override === "boolean") return override;
  return role === "company_owner" || role === "admin";
}

const ALL_MODULES: ModuleKey[] = [
  "dashboard",
  "master",
  "sales",
  "purchase",
  "inventory",
  "production",
  "transport",
  "accounting",
  "reports",
  "settings",
];

const VIEW_MODULES: Record<string, ModuleKey[]> = {
  company_owner: ALL_MODULES,
  admin: ALL_MODULES,
  accounts: ["dashboard", "accounting", "reports", "master"],
  sales: ["dashboard", "sales", "reports", "master", "inventory"],
  purchase: ["dashboard", "purchase", "reports", "master", "inventory"],
  store: ["dashboard", "inventory", "reports", "master"],
  production: ["dashboard", "production", "inventory", "reports", "master"],
  transport: ["dashboard", "transport", "accounting", "reports", "master", "settings"],
  viewer: ["dashboard", "reports"],
};

const OPERATIONAL_MODULE: Partial<Record<string, ModuleKey>> = {
  accounts: "accounting",
  sales: "sales",
  purchase: "purchase",
  store: "inventory",
  production: "production",
  transport: "transport",
};

export function canViewModule(role: CompanyRole | null | undefined, module: ModuleKey, isPlatformOwner = false) {
  if (isPlatformOwner) return true;
  if (!role) return false;
  return VIEW_MODULES[role]?.includes(module) ?? false;
}

export function defaultRolePermissions(role: CompanyRole | null | undefined): PermissionMatrix {
  const matrix: PermissionMatrix = {};
  for (const module of ALL_MODULES) {
    const canView = canViewModule(role, module, false);
    const fullAccess = role === "company_owner" || role === "admin";
    const operationalAccess = OPERATIONAL_MODULE[role ?? ""] === module;
    matrix[module] = {
      view: canView,
      print: canView,
      export: canView,
      create: fullAccess || operationalAccess,
      edit: fullAccess || operationalAccess,
      delete: fullAccess,
      post: fullAccess || operationalAccess,
    };
  }
  return matrix;
}

export function mergePermissions(base: PermissionMatrix, overrides?: PermissionMatrix | null): PermissionMatrix {
  const merged: PermissionMatrix = {};
  for (const module of ALL_MODULES) {
    merged[module] = {
      ...(base[module] ?? {}),
      ...(overrides?.[module] ?? {}),
    };
  }
  merged.transport_actions = { ...(base.transport_actions ?? {}), ...(overrides?.transport_actions ?? {}) };
  return merged;
}

export function hasPermission(
  role: CompanyRole | null | undefined,
  module: ModuleKey,
  action: ModuleAction,
  permissions?: PermissionMatrix | null,
  isPlatformOwner = false,
) {
  if (isPlatformOwner) return true;
  const effective = mergePermissions(defaultRolePermissions(role), permissions);
  return effective[module]?.[action] === true;
}

export function canPerformModule(
  role: CompanyRole | null | undefined,
  module: ModuleKey,
  action: ModuleAction,
  permissions?: Record<string, unknown> | null,
  isPlatformOwner = false,
) {
  return hasPermission(role, module, action, permissions as PermissionMatrix | null | undefined, isPlatformOwner);
}

export function roleLabel(role: CompanyRole | null | undefined) {
  if (!role) return "No role";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
