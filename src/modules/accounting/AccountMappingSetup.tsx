import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RotateCcw, Save } from "lucide-react";
import { ErrorBanner, LoadingState, PageHeader } from "@/components/ui";
import {
  ACCOUNT_MAPPING_TYPES,
  DEFAULT_MAPPINGS,
  listAccounts,
  listMappings,
  setMapping,
} from "@/lib/accountService";
import { AccountMapping, ChartOfAccount } from "@/types";

type MappingKey = (typeof DEFAULT_MAPPINGS)[number][0];

const MAPPING_GROUPS: Array<{
  title: string;
  subtitle: string;
  keys: MappingKey[];
}> = [
  {
    title: "Cash & Current Assets",
    subtitle: "Cash, bank, customer balances and stock control accounts.",
    keys: ["cash", "bank", "accounts_receivable", "inventory"],
  },
  {
    title: "Tax & Payables",
    subtitle: "Input/output VAT and supplier control accounts.",
    keys: ["input_vat", "output_vat", "accounts_payable"],
  },
  {
    title: "Equity & Income",
    subtitle: "Owner equity, retained profit and revenue accounts.",
    keys: ["share_capital", "retained_earnings", "sales_revenue", "service_revenue"],
  },
  {
    title: "Cost & Operating Expenses",
    subtitle: "Cost of sales and regular business expense accounts.",
    keys: ["cogs", "salaries", "rent", "utilities", "transport_expense", "general_expense"],
  },
];

const MAPPING_LABELS = Object.fromEntries(DEFAULT_MAPPINGS) as Record<MappingKey, string>;

export default function AccountMappingSetup() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [mappings, setMappings] = useState<AccountMapping[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const currentSelections = useMemo(
    () => Object.fromEntries(mappings.map((mapping) => [mapping.mapping_key, mapping.account_id])),
    [mappings]
  );

  const changedKeys = useMemo(
    () =>
      DEFAULT_MAPPINGS.map(([key]) => key).filter(
        (key) => selections[key] && selections[key] !== currentSelections[key]
      ),
    [currentSelections, selections]
  );

  const configuredCount = DEFAULT_MAPPINGS.filter(([key]) => currentSelections[key]).length;

  async function loadData(showLoader = true) {
    if (showLoader) setLoading(true);
    setError("");
    try {
      const [accountRows, mappingRows] = await Promise.all([listAccounts(), listMappings()]);
      setAccounts(accountRows);
      setMappings(mappingRows);
      setSelections(
        Object.fromEntries(mappingRows.map((mapping) => [mapping.mapping_key, mapping.account_id]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load account mappings.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function eligibleAccounts(key: MappingKey) {
    const requiredType = ACCOUNT_MAPPING_TYPES[key];
    return accounts.filter(
      (account) => account.is_active && !account.is_group && account.type === requiredType
    );
  }

  async function saveKeys(keys: MappingKey[]) {
    if (keys.length === 0) return;
    setError("");
    setSuccess("");
    setSavingKey(keys.length === 1 ? keys[0] : "all");
    try {
      for (const key of keys) {
        const accountId = selections[key];
        if (!accountId) throw new Error(`Select an account for ${MAPPING_LABELS[key]}.`);
        await setMapping(key, accountId);
      }
      const refreshedMappings = await listMappings();
      setMappings(refreshedMappings);
      setSelections(
        Object.fromEntries(refreshedMappings.map((mapping) => [mapping.mapping_key, mapping.account_id]))
      );
      setSuccess(keys.length === 1 ? `${MAPPING_LABELS[keys[0]]} mapping saved.` : `${keys.length} mappings saved successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save account mapping.");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Account Mapping Setup / اکاؤنٹ میپنگ"
        subtitle="Choose the exact posting account used by each accounting transaction."
        action={
          <div className="flex items-center gap-2" data-navilo-standard-tools-host>
            <button
              className="btn-secondary"
              disabled={changedKeys.length === 0 || savingKey !== null}
              onClick={() => {
                setSelections(currentSelections);
                setError("");
                setSuccess("");
              }}
            >
              <RotateCcw size={16} /> Reset
            </button>
            <button
              className="btn-primary"
              disabled={changedKeys.length === 0 || savingKey !== null}
              onClick={() => void saveKeys(changedKeys)}
            >
              <Save size={16} /> {savingKey === "all" ? "Saving…" : `Save all${changedKeys.length ? ` (${changedKeys.length})` : ""}`}
            </button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}
      {success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={18} /> {success}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Configured</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{configuredCount} / {DEFAULT_MAPPINGS.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unsaved changes</p>
          <p className={`mt-1 text-2xl font-bold ${changedKeys.length ? "text-amber-600" : "text-emerald-600"}`}>{changedKeys.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available posting accounts</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{accounts.filter((account) => account.is_active && !account.is_group).length}</p>
        </div>
      </div>

      <div className="mb-6 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <Link2 className="mt-0.5 shrink-0" size={18} />
        <p>Only active posting accounts of the correct accounting type are shown. A mapped account cannot be deactivated, converted to a group, or changed to an incompatible type until it is reassigned here.</p>
      </div>

      <div className="space-y-5">
        {MAPPING_GROUPS.map((group) => (
          <section className="card overflow-hidden" key={group.title}>
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h2 className="font-semibold text-slate-900">{group.title}</h2>
              <p className="mt-0.5 text-sm text-slate-500">{group.subtitle}</p>
            </div>
            <div className="divide-y divide-slate-100">
              {group.keys.map((key) => {
                const options = eligibleAccounts(key);
                const selectedId = selections[key] ?? "";
                const selectedExists = options.some((account) => account.id === selectedId);
                const isChanged = Boolean(selectedId && selectedId !== currentSelections[key]);
                const isSaving = savingKey === key;

                return (
                  <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(210px,0.8fr)_minmax(300px,1.5fr)_auto] lg:items-end" key={key}>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">{MAPPING_LABELS[key]}</p>
                        {currentSelections[key] ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Mapped</span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Missing</span>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-xs text-slate-400">{key}</p>
                      <p className="mt-1 text-xs capitalize text-slate-500">Required type: {ACCOUNT_MAPPING_TYPES[key]}</p>
                    </div>

                    <div>
                      <label className="label" htmlFor={`mapping-${key}`}>Posting account</label>
                      <SearchableSelect
                        className="input"
                        id={`mapping-${key}`}
                        value={selectedId}
                        disabled={savingKey !== null}
                        onChange={(event) => {
                          setSelections((previous) => ({ ...previous, [key]: event.target.value }));
                          setSuccess("");
                        }}
                      >
                        <option value="">Select {ACCOUNT_MAPPING_TYPES[key]} account…</option>
                        {selectedId && !selectedExists && (
                          <option value={selectedId} disabled>Current mapping is unavailable or invalid</option>
                        )}
                        {options.map((account) => (
                          <option value={account.id} key={account.id} data-search={account.code}>{account.name}</option>
                        ))}
                      </SearchableSelect>
                      {options.length === 0 && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle size={13} /> Create an active {ACCOUNT_MAPPING_TYPES[key]} posting account first.
                        </p>
                      )}
                    </div>

                    <button
                      className="btn-secondary min-w-24 justify-center"
                      disabled={!isChanged || savingKey !== null}
                      onClick={() => void saveKeys([key])}
                    >
                      <Save size={15} /> {isSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
