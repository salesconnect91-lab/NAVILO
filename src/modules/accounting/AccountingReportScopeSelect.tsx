import NaviloSearchableSelect from "@/components/SearchableSelect";
export type AccountingReportScope='branch'|'business_unit'|'company';
export default function AccountingReportScopeSelect({value,onChange}:{value:AccountingReportScope;onChange:(value:AccountingReportScope)=>void}){
 return <label data-report-filter-label="Report scope" data-report-filter-value={{branch:"Current Branch",business_unit:"Current Business Unit",company:"Whole Company"}[value]} className="no-print inline-flex items-center gap-2 text-xs font-semibold text-slate-700">Report Scope
  <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Report scope" className="input h-8 min-w-[170px] text-xs" value={value} onChange={e=>onChange(e.target.value as AccountingReportScope)}>
   <option value="branch">Current Branch</option>
   <option value="business_unit">Current Business Unit</option>
   <option value="company">Whole Company</option>
  </NaviloSearchableSelect>
 </label>;
}
