import { useMemo } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { isDedicatedTransportContext } from "@/lib/transportMasterContext";

// These canonical masters are company-owned (not BU-owned or global).
// Keep every existing non-Transport client path unchanged.
const companyTables = new Set(["items", "categories", "uom", "customers", "suppliers",
  "employees", "warehouses", "godowns", "charge_master", "chart_of_accounts"]);
const transportTables = new Set(["transport_vehicles", "transport_drivers", "transport_truck_types",
  "transport_locations", "transport_vehicle_expense_types", "transport_vehicle_ownership"]);

export function scopeMasterClient(client: typeof supabase, companyId: string, unitId: string): typeof supabase {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "from") {
        const member = Reflect.get(target, property, receiver);
        return typeof member === "function" ? member.bind(target) : member;
      }
      return (table: string) => {
        const builder = target.from(table);
        if (!companyTables.has(table) && !transportTables.has(table)) return builder;
        const transport = transportTables.has(table);
        const fields = { company_id: companyId, ...(transport ? { business_unit_id: unitId } : {}) };
        return new Proxy(builder, {
          get(query, method, queryReceiver) {
            const member = Reflect.get(query, method, queryReceiver);
            if (typeof member !== "function") return member;
            return (...args: unknown[]) => {
              if (method === "insert" || method === "upsert") {
                const values = args[0];
                args[0] = Array.isArray(values)
                  ? values.map(row => ({ ...row, ...fields })) : { ...(values as object), ...fields };
              }
              let result = member.apply(query, args);
              if (method === "select" || method === "update" || method === "delete") {
                result = result.eq("company_id", companyId);
                if (transport) result = result.eq("business_unit_id", unitId);
              }
              return result;
            };
          },
        });
      };
    },
  });
}

export default function useTransportMasterClient() {
  const { activeCompany, activeBusinessUnit } = useAuth();
  const dedicated = isDedicatedTransportContext(activeCompany, activeBusinessUnit);
  const companyId = activeCompany?.company_id ?? "";
  const unitId = activeBusinessUnit?.business_unit_id ?? "";
  return useMemo(() => dedicated ? scopeMasterClient(supabase, companyId, unitId) : supabase,
    [dedicated, companyId, unitId]);
}
