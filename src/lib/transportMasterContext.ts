type Company = { company_id?: string; enabled_modules?: string[] } | null | undefined;
type Unit = { business_unit_id?: string; business_unit_type?: string; enabled_modules?: string[] } | null | undefined;

export function isDedicatedTransportContext(company: Company, unit: Unit): boolean {
  return Boolean(company?.company_id && unit?.business_unit_id &&
    unit.business_unit_type === "transport" && company.enabled_modules?.includes("transport") &&
    unit.enabled_modules?.includes("transport"));
}
