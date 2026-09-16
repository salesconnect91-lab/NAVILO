import SearchableSelect from "@/components/SearchableSelect";
import { useState } from "react";
import { Building2, ChevronDown, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export default function CompanySwitcher() {
  const { activeCompany, availableCompanies, switchCompany, switchingCompany } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  if (availableCompanies.length <= 1) return null;

  return (
    <div className="fixed right-[116px] top-[7px] z-40 hidden min-w-[250px] md:block" data-no-bilingual data-no-print data-no-print-overlay>
      <div className="relative rounded-xl border border-slate-200/90 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur-xl">
        <div className="mb-0.5 flex items-center gap-1.5 px-1 text-[12px] font-bold uppercase tracking-[0.13em] text-slate-400">
          <Building2 size={10} />
          <span>Active Company / فعال کمپنی</span>
        </div>
        <div className="relative">
          <SearchableSelect
            aria-label="Active company / فعال کمپنی"
            title="Active company / فعال کمپنی"
            className="h-7 w-full appearance-none rounded-md border-0 bg-transparent pl-1 pr-8 text-[12px] font-bold text-slate-800 outline-none focus:ring-0 disabled:cursor-wait disabled:opacity-60"
            value={activeCompany?.company_id ?? ""}
            disabled={switchingCompany}
            onChange={(event) => {
              const companyId = event.target.value;
              if (!companyId) return;
              setError("");
              void switchCompany(companyId).then(({ error: switchError }) => {
                if (switchError) {
                  setError(switchError);
                  return;
                }
                window.dispatchEvent(new Event("navilo-workspace-changed"));
                navigate("/");
              });
            }}
          >
            {availableCompanies.map((company) => (
              <option key={company.company_id} value={company.company_id}>
                {company.company_name}
              </option>
            ))}
          </SearchableSelect>
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400">
            {switchingCompany ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} />}
          </span>
        </div>
      </div>
      {error && (
        <div className="mt-1 rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-[12px] font-medium text-red-600 shadow-sm">
          {error}
        </div>
      )}
    </div>
  );
}
