import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import SearchableSelect from "@/components/SearchableSelect";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, formatCurrency } from "@/components/ui";

type Account = { id: string; code: string; name: string; type: string; is_active: boolean; is_group: boolean };
type Party = { id: string; name: string; account_id: string | null; is_active?: boolean };
type Mapping = { mapping_key: string; account_id: string };
type Row = { key: string; accountId: string; partyType: "customer" | "supplier" | ""; partyId: string; debit: string; credit: string };
type Batch = { id: string; opening_year: number; opening_date: string; total_debit: number; total_credit: number; journal_entry_id: string };

const row = (): Row => ({ key: crypto.randomUUID(), accountId: "", partyType: "", partyId: "", debit: "", credit: "" });
const amount = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();

export default function OpeningBalances() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [rows, setRows] = useState<Row[]>([row(), row()]);
  const [openingDate, setOpeningDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const arId = mappings.find((x) => x.mapping_key === "accounts_receivable")?.account_id ?? "";
  const apId = mappings.find((x) => x.mapping_key === "accounts_payable")?.account_id ?? "";
  const year = Number(openingDate.slice(0, 4));
  const existing = batches.find((x) => x.opening_year === year);

  const postingAccounts = useMemo(
    () => accounts.filter((x) => x.is_active && !x.is_group && !["revenue", "expense"].includes(x.type)),
    [accounts]
  );

  const totals = useMemo(() => rows.reduce((acc, item) => {
    acc.debit += amount(item.debit);
    acc.credit += amount(item.credit);
    return acc;
  }, { debit: 0, credit: 0 }), [rows]);
  const difference = amount(totals.debit - totals.credit);

  const load = async () => {
    setLoading(true); setError(null);
    const [a, c, s, m, b] = await Promise.all([
      supabase.from("chart_of_accounts").select("id,code,name,type,is_active,is_group").eq("is_active", true).order("code"),
      supabase.from("customers").select("id,name,account_id,is_active").eq("is_active", true).order("name"),
      supabase.from("suppliers").select("id,name,account_id,is_active").eq("is_active", true).order("name"),
      supabase.from("account_mappings").select("mapping_key,account_id").in("mapping_key", ["accounts_receivable", "accounts_payable"]),
      supabase.from("opening_balance_batches").select("id,opening_year,opening_date,total_debit,total_credit,journal_entry_id").order("opening_year", { ascending: false }),
    ]);
    const firstError = a.error || c.error || s.error || m.error || b.error;
    if (firstError) setError(firstError.message);
    else {
      setAccounts((a.data ?? []) as Account[]);
      setCustomers((c.data ?? []) as Party[]);
      setSuppliers((s.data ?? []) as Party[]);
      setMappings((m.data ?? []) as Mapping[]);
      setBatches((b.data ?? []) as Batch[]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const update = (key: string, patch: Partial<Row>) => setRows((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  const selectAccount = (item: Row, accountId: string) => {
    if (accountId === arId) update(item.key, { accountId, partyType: "customer", partyId: "" });
    else if (accountId === apId) update(item.key, { accountId, partyType: "supplier", partyId: "" });
    else update(item.key, { accountId, partyType: "", partyId: "" });
  };
  const setDebit = (item: Row, value: string) => update(item.key, { debit: value, credit: Number(value) > 0 ? "" : item.credit });
  const setCredit = (item: Row, value: string) => update(item.key, { credit: value, debit: Number(value) > 0 ? "" : item.debit });

  const validate = () => {
    if (!/^\d{4}-01-01$/.test(openingDate)) return "Opening date must be January 1 of the opening year.";
    if (existing) return `Opening balances for ${year} are already posted.`;
    if (rows.length < 2) return "At least two opening lines are required.";
    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      if (!item.accountId) return `Line ${i + 1}: Account is required.`;
      const d = amount(item.debit), cr = amount(item.credit);
      if ((d > 0 && cr > 0) || (d <= 0 && cr <= 0)) return `Line ${i + 1}: Enter exactly one Debit or Credit amount.`;
      if (item.accountId === arId && (!item.partyId || item.partyType !== "customer")) return `Line ${i + 1}: Accounts Receivable requires a Customer.`;
      if (item.accountId === apId && (!item.partyId || item.partyType !== "supplier")) return `Line ${i + 1}: Accounts Payable requires a Supplier.`;
    }
    if (totals.debit <= 0 || Math.abs(difference) >= 0.01) return "Opening balances must have equal positive Debit and Credit totals.";
    return "";
  };

  const post = async () => {
    setError(null); setSuccess(null);
    const problem = validate(); if (problem) return setError(problem);
    if (!confirm(`Post opening balances for ${year}? After posting, use accounting correction/reversal workflow instead of editing history.`)) return;
    setPosting(true);
    const payload = rows.map((item) => ({
      account_id: item.accountId,
      party_type: item.partyType || null,
      party_id: item.partyId || null,
      debit: amount(item.debit),
      credit: amount(item.credit),
    }));
    const { data, error: rpcError } = await supabase.rpc("post_opening_balances", { p_opening_date: openingDate, p_lines: payload });
    setPosting(false);
    if (rpcError) return setError(rpcError.message);
    setSuccess(`Opening balances posted successfully. Journal ${String(data?.journal_entry_id ?? "created")}.`);
    setRows([row(), row()]);
    await load();
  };

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Account Code", "Account Name", "Party Type", "Party Name", "Debit", "Credit"],
      ["1110", "Cash", "", "", "100000", ""],
      ["3100", "Share Capital", "", "", "", "100000"],
    ]);
    sheet["!cols"] = [{ wch: 16 }, { wch: 32 }, { wch: 16 }, { wch: 32 }, { wch: 18 }, { wch: 18 }];
    const instructions = XLSX.utils.aoa_to_sheet([
      ["NAVILO Opening Balance Import"],
      ["Opening Date", "Select January 1 on screen before posting."],
      ["Allowed Accounts", "Asset, Liability and Equity posting accounts only. Revenue/Expense are blocked."],
      ["AR/AP", "Accounts Receivable requires Customer; Accounts Payable requires Supplier."],
      ["Debit/Credit", "Exactly one positive amount per line. File total Debit must equal Credit."],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, "Opening Balances"); XLSX.utils.book_append_sheet(wb, instructions, "Instructions");
    XLSX.writeFile(wb, "NAVILO-Opening-Balances-Template.xlsx");
  };

  const importFile = async (file: File) => {
    setError(null); setSuccess(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!raw.length) throw new Error("Import file has no opening balance rows.");
      const byCode = new Map(postingAccounts.map((x) => [normalize(x.code), x]));
      const byName = new Map(postingAccounts.map((x) => [normalize(x.name), x]));
      const customerByName = new Map(customers.map((x) => [normalize(x.name), x]));
      const supplierByName = new Map(suppliers.map((x) => [normalize(x.name), x]));
      const imported: Row[] = raw.map((record, index) => {
        const code = normalize(record["Account Code"] ?? record["account_code"]);
        const name = normalize(record["Account Name"] ?? record["account_name"]);
        const account = (code && byCode.get(code)) || (name && byName.get(name));
        if (!account) throw new Error(`Excel row ${index + 2}: valid posting Account Code/Name not found.`);
        const pTypeRaw = normalize(record["Party Type"] ?? record["party_type"]);
        const partyName = normalize(record["Party Name"] ?? record["party_name"]);
        let partyType: Row["partyType"] = "", partyId = "";
        if (account.id === arId) { partyType = "customer"; partyId = customerByName.get(partyName)?.id ?? ""; if (!partyId) throw new Error(`Excel row ${index + 2}: valid Customer is required for Accounts Receivable.`); }
        if (account.id === apId) { partyType = "supplier"; partyId = supplierByName.get(partyName)?.id ?? ""; if (!partyId) throw new Error(`Excel row ${index + 2}: valid Supplier is required for Accounts Payable.`); }
        if (account.id !== arId && account.id !== apId && (pTypeRaw || partyName)) throw new Error(`Excel row ${index + 2}: Party is only allowed on AR/AP.`);
        const debit = amount(record["Debit"] ?? record["debit"]); const credit = amount(record["Credit"] ?? record["credit"]);
        if ((debit > 0 && credit > 0) || (debit <= 0 && credit <= 0)) throw new Error(`Excel row ${index + 2}: enter exactly one positive Debit or Credit.`);
        return { key: crypto.randomUUID(), accountId: account.id, partyType, partyId, debit: debit ? String(debit) : "", credit: credit ? String(credit) : "" };
      });
      setRows(imported); setSuccess(`${imported.length} opening balance lines imported for preview. Review and Post when ready.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read opening balance file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  if (loading) return <div className="rounded-xl border bg-white p-8 text-sm text-slate-500">Loading opening balances...</div>;

  return <div className="space-y-5 max-w-7xl mx-auto pb-12">
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Opening Balances</h1><p className="mt-1 text-sm text-slate-500">Post controlled opening Asset, Liability and Equity balances into General Ledger and party sub-ledgers.</p></div>
        <div className="flex flex-wrap gap-2">
          <span data-navilo-standard-tools-host className="contents" />
          <button type="button" className="btn-secondary" onClick={downloadTemplate}><Download className="h-4 w-4"/> Template</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])}/>
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4"/> Import File</button>
        </div>
      </div>
    </div>

    {error && <ErrorBanner message={error}/>} {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{success}</div>}

    <div className="grid gap-3 md:grid-cols-4" data-no-print data-no-export>
      <label className="rounded-xl border bg-white p-4 text-xs font-bold text-slate-600">OPENING DATE<input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="input mt-2 w-full"/></label>
      <div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold text-slate-500">TOTAL DEBIT</div><div className="mt-2 text-xl font-bold">{formatCurrency(totals.debit)}</div></div>
      <div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold text-slate-500">TOTAL CREDIT</div><div className="mt-2 text-xl font-bold">{formatCurrency(totals.credit)}</div></div>
      <div className="rounded-xl border bg-white p-4"><div className="text-xs font-bold text-slate-500">DIFFERENCE</div><div className={`mt-2 text-xl font-bold ${Math.abs(difference) < .01 ? "text-emerald-700" : "text-rose-700"}`}>{formatCurrency(Math.abs(difference))}</div></div>
    </div>

    {existing && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><b>{year} opening balances are already posted and locked.</b> Debit {formatCurrency(existing.total_debit)} = Credit {formatCurrency(existing.total_credit)}. Use accounting correction/reversal controls rather than editing posted history.</div>}

    <div className="overflow-hidden rounded-xl border bg-white shadow-sm" data-report-content>
      <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
        <div><div className="navilo-report-title font-bold text-slate-800">Opening Balances</div><div className="text-xs text-slate-500">Opening date: {openingDate} · Revenue and expense accounts are intentionally excluded.</div></div>
        <button type="button" className="btn-secondary" data-no-print data-no-export disabled={Boolean(existing)} onClick={() => setRows((x) => [...x, row()])}><Plus className="h-4 w-4"/> Add Line</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-white text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">Account</th><th className="px-3 py-3 text-left">Party</th><th className="px-3 py-3 text-right">Debit</th><th className="px-3 py-3 text-right">Credit</th><th className="px-3 py-3 text-right" data-no-print data-no-export>Action</th></tr></thead><tbody className="divide-y">{rows.map((item) => {
        const parties = item.partyType === "customer" ? customers : item.partyType === "supplier" ? suppliers : [];
        return <tr key={item.key}>
          <td className="px-3 py-3"><SearchableSelect className="input w-full" disabled={Boolean(existing)} value={item.accountId} onChange={(e) => selectAccount(item, e.target.value)}><option value="">Select posting account</option>{postingAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</SearchableSelect></td>
          <td className="px-3 py-3">{item.partyType ? <SearchableSelect className="input w-full" disabled={Boolean(existing)} value={item.partyId} onChange={(e) => update(item.key, { partyId: e.target.value })}><option value="">Select {item.partyType}</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SearchableSelect> : <span className="text-slate-400">Not applicable</span>}</td>
          <td className="px-3 py-3"><input className="input w-full text-right font-mono" type="number" min="0" step="0.01" disabled={Boolean(existing)} value={item.debit} onChange={(e) => setDebit(item, e.target.value)}/></td>
          <td className="px-3 py-3"><input className="input w-full text-right font-mono" type="number" min="0" step="0.01" disabled={Boolean(existing)} value={item.credit} onChange={(e) => setCredit(item, e.target.value)}/></td>
          <td className="px-3 py-3 text-right" data-no-print data-no-export><button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-slate-500 hover:bg-slate-50 disabled:opacity-40" disabled={Boolean(existing) || rows.length <= 2} onClick={() => setRows((x) => x.filter((r) => r.key !== item.key))} title="Remove line"><Trash2 className="h-4 w-4"/></button></td>
        </tr>;
      })}</tbody><tfoot><tr className="border-t-2 bg-slate-50 font-bold"><td colSpan={2} className="px-3 py-3">GRAND TOTAL</td><td className="px-3 py-3 text-right">{formatCurrency(totals.debit)}</td><td className="px-3 py-3 text-right">{formatCurrency(totals.credit)}</td><td data-no-print data-no-export/></tr></tfoot></table></div>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4" data-no-print data-no-export><p className="max-w-3xl text-xs text-slate-500">Posting creates a balanced, locked opening journal. AR/AP lines also feed customer/supplier sub-ledgers. Duplicate opening batches for the same business unit/year are blocked.</p><button type="button" className="btn-primary" disabled={posting || Boolean(existing)} onClick={() => void post()}>{posting ? "Posting..." : "Post Opening Balances"}</button></div>
  </div>;
}
