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
        if (!companyTables.has(table) && !transportTables.has(table)) return target.from(table);
        const transport = transportTables.has(table);
        const fields = { company_id: companyId, ...(transport ? { business_unit_id: unitId } : {}) };

        // Scope the query through the real Supabase builder instead of proxying it.
        // Supabase builders are thenable and rely on their own method receiver; wrapping
        // the builder in another Proxy can break request/header propagation on mutations.
        const scoped = target.from(table).select("*");
        const companyScoped = scoped.eq("company_id", companyId);
        const baseScoped = transport ? companyScoped.eq("business_unit_id", unitId) : companyScoped;

        return new Proxy(target.from(table), {
          get(query, method, queryReceiver) {
            const member = Reflect.get(query, method, queryReceiver);
            if (typeof member !== "function") return member;
            return (...args: unknown[]) => {
              if (method === "insert" || method === "upsert") {
                const values = args[0];
                args[0] = Array.isArray(values)
                  ? values.map(row => ({ ...row, ...fields })) : { ...(values as object), ...fields };
                return target.from(table)[method](args[0] as never);
              }
              if (method === "select") return baseScoped;
              if (method === "update") {
                const update = target.from(table).update(args[0] as never).eq("company_id", companyId);
                return transport ? update.eq("business_unit_id", unitId) : update;
              }
              if (method === "delete") {
                const remove = target.from(table).delete().eq("company_id", companyId);
                return transport ? remove.eq("business_unit_id", unitId) : remove;
              }
              return member.apply(query, args);
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
