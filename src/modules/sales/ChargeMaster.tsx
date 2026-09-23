import SearchableSelect from "@/components/SearchableSelect";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Pencil, Plus, Power, Save, Trash2, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toUrduName } from "@/lib/urdu";
import { ErrorBanner, Modal, PageHeader } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";
import type { ConfiguredChargeUnit } from "@/lib/chargeCalculation";

type ChargeType = "recovery" | "cost" | "both";
type ChargeContext = "sales" | "purchase" | "both";
type PurchaseTreatment = "landed_cost" | "expense";
type ChargeUnit = ConfiguredChargeUnit;
type Charge = {
  id: string;
  charge_key: string;
  charge_name: string;
  charge_name_urdu: string | null;
  charge_type: ChargeType;
  revenue_account_id: string | null;
  cost_account_id: string | null;
  tax_applicable: boolean;
  service_party_required: boolean;
  default_rate: number;
  unit: ChargeUnit;
  applies_to: ChargeContext;
  purchase_treatment: PurchaseTreatment | null;
  is_fixed: boolean;
  is_active: boolean;
  description: string | null;
};
type Account = { id: string; code: string; name: string; type: string };
type ChargeForm = Omit<Charge, "id" | "charge_key" | "default_rate" | "revenue_account_id" | "cost_account_id" | "charge_name_urdu" | "description"> & {
  charge_name: string;
  charge_name_urdu: string;
  default_rate: string;
  revenue_account_id: string;
  cost_account_id: string;
  description: string;
  purchase_treatment: PurchaseTreatment;
};

const emptyForm: ChargeForm = {
  charge_name: "",
  charge_name_urdu: "",
  charge_type: "cost",
  revenue_account_id: "",
  cost_account_id: "",
  tax_applicable: true,
  service_party_required: false,
  default_rate: "0",
  unit: "fixed",
  applies_to: "purchase",
  purchase_treatment: "landed_cost",
  is_fixed: false,
  is_active: true,
  description: "",
};

const makeKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const clean = (value: unknown) => String(value ?? "").trim();
const yes = (value: unknown, fallback = false) => {
  const text = clean(value).toLowerCase();
  return text ? ["yes", "y", "true", "1", "active", "on"].includes(text) : fallback;
};
const UNIT_OPTIONS: { value: ChargeUnit; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "per_qty", label: "Qty" },
  { value: "per_kg", label: "Per Kg" },
  { value: "per_ton", label: "Per Ton" },
  { value: "percent", label: "Percent" },
  { value: "manual", label: "Manual" },
  { value: "per_piece", label: "Per Piece" },
];
const validUnits = new Set(UNIT_OPTIONS.map((row) => row.value));
const normalizedTypeForContext = (context: ChargeContext, type: ChargeType): ChargeType =>
  context === "purchase" ? "cost" : context === "sales" && type === "cost" ? "recovery" : type;

export default function ChargeMaster() {
  const { activeCompany, isPlatformOwner } = useAuth();
  const canCreate = canPerformModule(activeCompany?.membership_role, "master", "create", activeCompany?.permissions, isPlatformOwner);
  const canEdit = canPerformModule(activeCompany?.membership_role, "master", "edit", activeCompany?.permissions, isPlatformOwner);
  const canDelete = canPerformModule(activeCompany?.membership_role, "master", "delete", activeCompany?.permissions, isPlatformOwner);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<ChargeForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [chargeRes, accountRes] = await Promise.all([
      supabase.from("charge_master").select("*").order("charge_name"),
      supabase.from("chart_of_accounts").select("id,code,name,type").eq("is_active", true).eq("is_group", false).eq("allow_manual_entries", true).order("code"),
    ]);
    setLoading(false);
    if (chargeRes.error || accountRes.error) return setError(chargeRes.error?.message || accountRes.error?.message || "Load failed.");
    setCharges((chargeRes.data ?? []) as Charge[]);
    setAccounts((accountRes.data ?? []) as Account[]);
    setError("");
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startAdd = () => { setEditingId(null); setForm(emptyForm); setError(""); setOpen(true); };
  const startEdit = (charge: Charge) => {
    setEditingId(charge.id);
    setForm({
      charge_name: charge.charge_name,
      charge_name_urdu: charge.charge_name_urdu ?? toUrduName(charge.charge_name),
      charge_type: normalizedTypeForContext(charge.applies_to, charge.charge_type),
      revenue_account_id: charge.applies_to === "purchase" ? "" : charge.revenue_account_id ?? "",
      cost_account_id: charge.cost_account_id ?? "",
      tax_applicable: charge.tax_applicable,
      service_party_required: charge.service_party_required,
      default_rate: String(charge.default_rate ?? 0),
      unit: charge.unit ?? "fixed",
      applies_to: charge.applies_to ?? "purchase",
      purchase_treatment: charge.purchase_treatment ?? "landed_cost",
      is_fixed: charge.is_fixed ?? false,
      is_active: charge.is_active,
      description: charge.description ?? "",
    });
    setError("");
    setOpen(true);
  };

  const changeContext = (context: ChargeContext) => setForm((current) => ({
    ...current,
    applies_to: context,
    charge_type: context === "purchase" ? "cost" : context === "sales" ? "recovery" : "both",
    revenue_account_id: context === "purchase" ? "" : current.revenue_account_id,
  }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = form.charge_name.trim();
    const key = makeKey(name);
    if (!name || !key) return setError("Valid Charge Name is required.");
    const type = normalizedTypeForContext(form.applies_to, form.charge_type);
    const needsRevenue = form.applies_to !== "purchase" && (type === "recovery" || type === "both");
    const needsCost = form.applies_to !== "sales" && (type === "cost" || type === "both");
    if (needsRevenue && !form.revenue_account_id) return setError("Revenue Account is required for Sales recovery charges.");
    if (needsCost && !form.cost_account_id) return setError("Cost Account is required for Purchase charges.");
    if (form.unit === "manual" && form.is_fixed) return setError("Manual basis cannot use Lock Rate. Manual amount must remain editable on the document.");

    setSaving(true);
    const payload = {
      charge_key: key,
      charge_name: name,
      charge_name_urdu: form.charge_name_urdu.trim() || toUrduName(name),
      charge_type: type,
      revenue_account_id: needsRevenue ? form.revenue_account_id : null,
      cost_account_id: needsCost || type === "cost" || type === "both" ? form.cost_account_id || null : null,
      tax_applicable: form.tax_applicable,
      service_party_required: form.service_party_required,
      default_rate: form.unit === "manual" ? 0 : Math.max(0, Number(form.default_rate) || 0),
      unit: form.unit,
      applies_to: form.applies_to,
      purchase_treatment: form.applies_to === "sales" ? null : form.purchase_treatment,
      is_fixed: form.unit === "manual" ? false : form.is_fixed,
      is_active: form.is_active,
      description: form.description.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const result = editingId
      ? await supabase.from("charge_master").update(payload).eq("id", editingId)
      : await supabase.from("charge_master").insert(payload);
    setSaving(false);
    if (result.error) return setError(result.error.message);
    setOpen(false); setEditingId(null); setForm(emptyForm); await load();
  };

  const toggle = async (charge: Charge) => {
    const { error: toggleError } = await supabase.from("charge_master").update({ is_active: !charge.is_active, updated_at: new Date().toISOString() }).eq("id", charge.id);
    if (toggleError) setError(toggleError.message); else await load();
  };
  const remove = async (charge: Charge) => {
    if (!confirm(`Delete ${charge.charge_name}?`)) return;
    const { error: deleteError } = await supabase.from("charge_master").delete().eq("id", charge.id);
    if (deleteError) setError(deleteError.message); else await load();
  };
  const accountLabel = (id: string | null) => {
    const account = accounts.find((candidate) => candidate.id === id);
    return account?.name || "—";
  };
  const unitLabel = (unit: ChargeUnit) => UNIT_OPTIONS.find((option) => option.value === unit)?.label || unit;

  const exportExcel = () => {
    const sheet = XLSX.utils.json_to_sheet(charges.map((charge) => ({
      "Charge Name": charge.charge_name,
      "Urdu Name": charge.charge_name_urdu ?? "",
      Type: charge.charge_type,
      Rate: Number(charge.default_rate || 0),
      Unit: charge.unit,
      "Applies To": charge.applies_to,
      "Purchase Treatment": charge.purchase_treatment ?? "",
      "Revenue Account Code": accounts.find((account) => account.id === charge.revenue_account_id)?.code ?? "",
      "Cost Account Code": accounts.find((account) => account.id === charge.cost_account_id)?.code ?? "",
      "Tax Applicable": charge.tax_applicable ? "Yes" : "No",
      "Service Party Required": charge.service_party_required ? "Yes" : "No",
      "Lock Rate": charge.is_fixed ? "Yes" : "No",
      Active: charge.is_active ? "Yes" : "No",
      Description: charge.description ?? "",
    })));
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Charge Master"); XLSX.writeFile(book, "charge_master.xlsx");
  };

  const downloadTemplate = () => {
    const sheet = XLSX.utils.json_to_sheet([
      { "Charge Name": "Unloading Charges", "Urdu Name": "ان لوڈنگ چارجز", Type: "cost", Rate: 300, Unit: "per_ton", "Applies To": "purchase", "Purchase Treatment": "landed_cost", "Revenue Account Code": "", "Cost Account Code": "6410", "Tax Applicable": "Yes", "Service Party Required": "No", "Lock Rate": "Yes", Active: "Yes", Description: "Auto calculated by purchased tons" },
      { "Charge Name": "Handling Qty", "Urdu Name": "ہینڈلنگ", Type: "recovery", Rate: 10, Unit: "per_qty", "Applies To": "sales", "Purchase Treatment": "", "Revenue Account Code": "4200", "Cost Account Code": "", "Tax Applicable": "No", "Service Party Required": "No", "Lock Rate": "No", Active: "Yes", Description: "Qty × rate" },
      { "Charge Name": "Manual Adjustment", "Urdu Name": "دستی چارج", Type: "recovery", Rate: 0, Unit: "manual", "Applies To": "sales", "Purchase Treatment": "", "Revenue Account Code": "4200", "Cost Account Code": "", "Tax Applicable": "No", "Service Party Required": "No", "Lock Rate": "No", Active: "Yes", Description: "Entered manually on document" },
    ]);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Charge Master"); XLSX.writeFile(book, "charge_master_import_template.xlsx");
  };

  const importExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!canCreate) return setError("You do not have permission to import charges.");
    setSaving(true); setError("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const accountByCode = new Map(accounts.map((account) => [account.code.trim().toLowerCase(), account]));
      const existing = new Set(charges.map((charge) => charge.charge_key));
      const seen = new Set<string>();
      const payload: Record<string, unknown>[] = [];
      const errors: string[] = [];
      raw.forEach((row, index) => {
        const name = clean(row["Charge Name"] ?? row.Name ?? row.charge_name); if (!name) return;
        const key = makeKey(name); if (!key || existing.has(key) || seen.has(key)) return errors.push(`Row ${index + 2}: Duplicate or invalid charge "${name}".`);
        const applies = (clean(row["Applies To"] ?? row.applies_to).toLowerCase() || "purchase") as ChargeContext;
        if (!["sales", "purchase", "both"].includes(applies)) return errors.push(`Row ${index + 2}: Applies To must be sales, purchase or both.`);
        let type = (clean(row.Type ?? row.charge_type).toLowerCase() || (applies === "purchase" ? "cost" : applies === "sales" ? "recovery" : "both")) as ChargeType;
        type = normalizedTypeForContext(applies, type);
        const unit = (clean(row.Unit ?? row.unit).toLowerCase() || "fixed") as ChargeUnit;
        if (!validUnits.has(unit)) return errors.push(`Row ${index + 2}: Unit must be fixed, per_qty, per_kg, per_ton, percent, manual or per_piece.`);
        const treatment = (clean(row["Purchase Treatment"] ?? row.purchase_treatment).toLowerCase() || "landed_cost") as PurchaseTreatment;
        if (applies !== "sales" && !["landed_cost", "expense"].includes(treatment)) return errors.push(`Row ${index + 2}: Purchase Treatment must be landed_cost or expense.`);
        const revenue = accountByCode.get(clean(row["Revenue Account Code"] ?? row.revenue_account_code).toLowerCase());
        const cost = accountByCode.get(clean(row["Cost Account Code"] ?? row.cost_account_code).toLowerCase());
        const needsRevenue = applies !== "purchase" && (type === "recovery" || type === "both");
        const needsCost = applies !== "sales" && (type === "cost" || type === "both");
        if (needsRevenue && (!revenue || revenue.type !== "revenue")) return errors.push(`Row ${index + 2}: Valid revenue account code is required.`);
        if (needsCost && (!cost || cost.type !== "expense")) return errors.push(`Row ${index + 2}: Valid expense account code is required.`);
        const rate = unit === "manual" ? 0 : Number(clean(row.Rate ?? row.default_rate) || 0);
        if (!Number.isFinite(rate) || rate < 0) return errors.push(`Row ${index + 2}: Rate must be zero or greater.`);
        seen.add(key);
        payload.push({ charge_key: key, charge_name: name, charge_name_urdu: clean(row["Urdu Name"] ?? row.charge_name_urdu) || toUrduName(name), charge_type: type, revenue_account_id: needsRevenue ? revenue?.id ?? null : null, cost_account_id: needsCost ? cost?.id ?? null : null, tax_applicable: yes(row["Tax Applicable"] ?? row.tax_applicable), service_party_required: yes(row["Service Party Required"] ?? row.service_party_required), default_rate: rate, unit, applies_to: applies, purchase_treatment: applies === "sales" ? null : treatment, is_fixed: unit === "manual" ? false : yes(row["Lock Rate"] ?? row.is_fixed), is_active: yes(row.Active ?? row.is_active, true), description: clean(row.Description ?? row.description) || null, updated_at: new Date().toISOString() });
      });
      if (errors.length) throw new Error(errors.slice(0, 8).join(" "));
      if (!payload.length) throw new Error("No valid charge rows found in the file.");
      const { error: importError } = await supabase.from("charge_master").insert(payload); if (importError) throw importError; await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Charge import failed."); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const actions = <div className="flex flex-wrap gap-2">
    <button className="btn-secondary" onClick={downloadTemplate}><Download size={16} />Template</button>
    {canCreate && <button className="btn-secondary" disabled={saving} onClick={() => fileRef.current?.click()}><Upload size={16} />Import</button>}
    <input ref={fileRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={importExcel} />
    <button className="btn-secondary" onClick={exportExcel}><FileSpreadsheet size={16} />Excel</button>
    {canCreate && <button className="btn-primary" onClick={startAdd}><Plus size={16} />Add Charge</button>}
  </div>;

  return <div className="space-y-5">
    <PageHeader title="Charge Master" subtitle="Central Sales/Purchase charges: Fixed, Qty, Kg, Ton, %, Manual and Piece with accounting, tax and landed-cost rules." action={actions} />
    {error && <ErrorBanner message={error} />}
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Charge</th><th className="p-3 text-right">Urdu Name</th><th className="p-3">Basis / Rate</th><th className="p-3">Applies To</th><th className="p-3">Purchase Treatment</th><th className="p-3">Revenue COA</th><th className="p-3">Cost COA</th><th className="p-3">Tax</th><th className="p-3">Status</th><th /></tr></thead><tbody>{loading ? <tr><td colSpan={10} className="p-6 text-center">Loading...</td></tr> : charges.map((charge) => <tr key={charge.id} className="border-t"><td className="p-3"><div className="font-medium">{charge.charge_name}</div><div className="text-xs text-slate-400">{charge.charge_key} · {charge.charge_type}</div></td><td dir="rtl" className="p-3 text-right">{charge.charge_name_urdu || "—"}</td><td className="p-3 whitespace-nowrap"><div>{unitLabel(charge.unit)}</div><div className="text-xs text-slate-500">{charge.unit === "manual" ? "Entered on document" : `Rate ${Number(charge.default_rate || 0).toLocaleString()}${charge.is_fixed ? " · Locked" : ""}`}</div></td><td className="p-3 capitalize">{charge.applies_to}</td><td className="p-3">{charge.applies_to === "sales" ? "—" : charge.purchase_treatment === "expense" ? "Expense" : "Landed Cost / Inventory"}</td><td className="p-3">{accountLabel(charge.revenue_account_id)}</td><td className="p-3">{accountLabel(charge.cost_account_id)}</td><td className="p-3">{charge.tax_applicable ? "Yes" : "No"}</td><td className="p-3">{charge.is_active ? "Active" : "Inactive"}</td><td className="p-3"><div className="flex justify-end gap-2">{canEdit && <button onClick={() => startEdit(charge)} className="rounded border p-2"><Pencil size={15} /></button>}{canEdit && <button onClick={() => void toggle(charge)} className="rounded border p-2"><Power size={15} /></button>}{canDelete && <button onClick={() => void remove(charge)} className="rounded border p-2 text-red-600"><Trash2 size={15} /></button>}</div></td></tr>)}</tbody></table></div>

    <Modal open={open} title={editingId ? "Edit Charge" : "Add Charge"} onClose={() => !saving && setOpen(false)}>
      <form onSubmit={save} className="space-y-4">
        <div><label className="label">Charge Name (English)</label><input className="input" value={form.charge_name} onChange={(e) => setForm((current) => ({ ...current, charge_name: e.target.value, charge_name_urdu: !current.charge_name_urdu || current.charge_name_urdu === toUrduName(current.charge_name) ? toUrduName(e.target.value) : current.charge_name_urdu }))} /></div>
        <div><div className="mb-1 flex items-center justify-between"><label className="label mb-0">Urdu Name</label><button type="button" className="btn-secondary text-xs" onClick={() => setForm((current) => ({ ...current, charge_name_urdu: toUrduName(current.charge_name) }))}>Auto Urdu</button></div><input dir="rtl" className="input text-right" value={form.charge_name_urdu} onChange={(e) => setForm((current) => ({ ...current, charge_name_urdu: e.target.value }))} /></div>
        <div><label className="label">Applies To / لاگو</label><SearchableSelect className="input" value={form.applies_to} onChange={(e) => changeContext(e.target.value as ChargeContext)}><option value="purchase">Purchase</option><option value="sales">Sales</option><option value="both">Sales + Purchase</option></SearchableSelect></div>
        <div className="grid gap-3 sm:grid-cols-3"><div><label className="label">Type</label><SearchableSelect className="input" value={form.charge_type} disabled={form.applies_to !== "both"} onChange={(e) => setForm((current) => ({ ...current, charge_type: e.target.value as ChargeType }))}>{form.applies_to === "purchase" ? <option value="cost">Cost</option> : form.applies_to === "sales" ? <option value="recovery">Recovery</option> : <><option value="both">Both</option><option value="recovery">Recovery</option><option value="cost">Cost</option></>}</SearchableSelect></div><div><label className="label">Calculation Basis</label><SearchableSelect className="input" value={form.unit} onChange={(e) => setForm((current) => ({ ...current, unit: e.target.value as ChargeUnit, default_rate: e.target.value === "manual" ? "0" : current.default_rate, is_fixed: e.target.value === "manual" ? false : current.is_fixed }))}>{UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</SearchableSelect></div><div><label className="label">Rate / ریٹ</label><input type="number" min="0" step="0.01" className="input" disabled={form.unit === "manual"} value={form.default_rate} onChange={(e) => setForm((current) => ({ ...current, default_rate: e.target.value }))} /></div></div>
        {form.unit === "manual" && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Manual basis par amount invoice/purchase document par enter hoga; Charge Master mein rate 0 rahega.</div>}
        {form.applies_to !== "sales" && <div><label className="label">Purchase Treatment</label><SearchableSelect className="input" value={form.purchase_treatment} onChange={(e) => setForm((current) => ({ ...current, purchase_treatment: e.target.value as PurchaseTreatment }))}><option value="landed_cost">Landed Cost / Inventory</option><option value="expense">Expense</option></SearchableSelect></div>}
        {form.applies_to !== "purchase" && <div><label className="label">Revenue Account</label><SearchableSelect className="input" value={form.revenue_account_id} onChange={(e) => setForm((current) => ({ ...current, revenue_account_id: e.target.value }))}><option value="">Select Revenue COA</option>{accounts.filter((account) => account.type === "revenue").map((account) => <option key={account.id} value={account.id} data-search={account.code}>{account.name}</option>)}</SearchableSelect></div>}
        {form.applies_to !== "sales" && <div><label className="label">Cost Account</label><SearchableSelect className="input" value={form.cost_account_id} onChange={(e) => setForm((current) => ({ ...current, cost_account_id: e.target.value }))}><option value="">Select Expense COA</option>{accounts.filter((account) => account.type === "expense").map((account) => <option key={account.id} value={account.id} data-search={account.code}>{account.name}</option>)}</SearchableSelect></div>}
        <div className="grid grid-cols-2 gap-2"><label className="rounded border p-3"><input type="checkbox" checked={form.tax_applicable} onChange={(e) => setForm((current) => ({ ...current, tax_applicable: e.target.checked }))} /> Tax Applicable</label><label className="rounded border p-3"><input type="checkbox" checked={form.service_party_required} onChange={(e) => setForm((current) => ({ ...current, service_party_required: e.target.checked }))} /> Service Party</label><label className="rounded border p-3"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.checked }))} /> Active</label><label className="rounded border p-3"><input type="checkbox" disabled={form.unit === "manual"} checked={form.is_fixed} onChange={(e) => setForm((current) => ({ ...current, is_fixed: e.target.checked }))} /> Lock Rate</label></div>
        <div><label className="label">Description</label><textarea className="input min-h-20" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} /></div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}><X size={16} />Cancel</button><button className="btn-primary" disabled={saving}><Save size={16} />{saving ? "Saving..." : "Save Charge"}</button></div>
      </form>
    </Modal>
  </div>;
}
