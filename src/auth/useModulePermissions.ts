import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleAction, type ModuleKey } from "@/auth/permissions";

export function useModulePermissions(module: ModuleKey) {
  const { activeBusinessUnit, activeCompany, isPlatformOwner } = useAuth();
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = activeBusinessUnit?.permissions ?? activeCompany?.permissions;
  const can = (action: ModuleAction) => isPlatformOwner || hasPermission(role, module, action, permissions, false);
  return {
    can,
    canCreate: can("create"),
    canEdit: can("edit"),
    canDelete: can("delete"),
    canExport: can("export"),
    canPrint: can("print"),
  };
}
