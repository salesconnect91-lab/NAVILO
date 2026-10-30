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
  _permissions: Record<string, unknown> | null | undefined, _action: TransportAction, isPlatformOwner = false) {
  return Boolean(isPlatformOwner || role);
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
  transport_mobile: ["transport"],
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

export function canViewModule(role: CompanyRole | null | undefined, _module: ModuleKey, isPlatformOwner = false) {
  return Boolean(isPlatformOwner || role);
}

export function defaultRolePermissions(role: CompanyRole | null | undefined): PermissionMatrix {
  const matrix: PermissionMatrix = {};
  if (!role) return matrix;
  for (const module of ALL_MODULES) {
    matrix[module] = { view:true, print:true, export:true, create:true, edit:true, delete:true, post:true };
  }
  matrix.transport_actions = {
    customer_finance_view:true, supplier_finance_view:true, trip_create:true, trip_edit:true,
    trip_cancel:true, trip_delete:true, customer_rate_finalize:true, customer_rate_override:true,
    rent_finalize:true, rent_correct:true, vehicle_owner_change:true, assignment_replace:true,
    ppr_receive:true, master_manage:true, number_config:true, settlement_post:true,
    settlement_unpost:true, billing_adjust:true, payment_correct:true,
    driver_month_close:true, driver_month_reopen:true,
  };
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
  _module: ModuleKey,
  _action: ModuleAction,
  _permissions?: PermissionMatrix | null,
  isPlatformOwner = false,
) {
  return Boolean(isPlatformOwner || role);
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
  if (role === "transport_mobile") return "Transport Mobile Only";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
