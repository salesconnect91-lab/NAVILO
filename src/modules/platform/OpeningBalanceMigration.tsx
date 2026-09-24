import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, ShieldCheck, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { toUrduName } from "@/lib/urdu";

type PartyType = "customer" | "supplier";
type BalanceSide = "debit" | "credit";

type ImportRow = {
  rowNo: number;
  party_type: PartyType | "";
  name: string;
  name_urdu: string;
  amount: number;
  side: BalanceSide | "";
  email: string;
  phone: string;
  address: string;
  match: "new" | "existing" | "invalid";
  issue: string;
};

type ImportResult = {
  entry_id: string;
  entry_no: string;
  rows_imported: number;
  created_customers: number;
  existing_customers: number;
  created_suppliers: number;
  existing_suppliers: number;
  party_debit_total: number;
  party_credit_total: number;
};

const text = (value: unknown) => String(value ?? "").trim();
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const partyKey = (type: string, name: string) => `${type}:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;

function pick(record: Record<string, unknown>, names: string[]) {
  const wanted = new Set(names.map(key));
  for (const [header, value] of Object.entries(record)) if (wanted.has(key(header))) return value;
  return undefined;
}

function normalizePartyType(value: unknown): PartyType | "" {
  const v = text(value).toLowerCase();
  if (["customer", "customers", "cust", "c"].includes(v)) return "customer";
  if (["supplier", "suppliers", "vendor", "vendors", "sup", "s"].includes(v)) return "supplier";
  return "";
}

function normalizeSide(value: unknown): BalanceSide | "" {
  const v = text(value).toLowerCase();
  if (["debit", "dr", "d"].includes(v)) return "debit";
  if (["credit", "cr", "c"].includes(v)) return "credit";
  return "";
}

export default function OpeningBalanceMigration() {
  const { isPlatformOwner, activeCompany } = useAuth();
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    if (!row.issue && row.side === "debit") acc.debit += row.amount;
    if (!row.issue && row.side === "credit") acc.credit += row.amount;
    if (row.match === "new") acc.newCount += 1;
    if (row.match === "existing") acc.existingCount += 1;
    if (row.issue) acc.invalid += 1;
    return acc;
  }, { debit: 0, credit: 0, newCount: 0, existingCount: 0, invalid: 0 }), [rows]);

  const downloadTemplate = () => {
    const headers = [["Party Type", "English Name", "Urdu Name", "Opening Balance", "Balance Side", "Email", "Phone", "Address"]];
    const sheet = XLSX.utils.aoa_to_sheet(headers);
    sheet["!cols"] = [{ wch: 16 }, { wch: 32 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 40 }];
    const instructions = XLSX.utils.aoa_to_sheet([
      ["Opening Party Balance Import - Platform Owner Only"],
      ["Party Type", "Customer or Supplier"],
      ["English Name", "Required. Existing names are matched case-insensitively; missing names are created automatically."],
      ["Urdu Name", "Optional. Leave blank to auto-generate Urdu from English."],
      ["Opening Balance", "Positive number only."],
      ["Balance Side", "Debit/Dr or Credit/Cr."],
      ["Opening Date", "Choose one opening date on the import screen before posting."],
      ["Important", "Duplicate Party Type + English Name rows in one file are blocked. Merge them into one opening balance first."],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Opening Balances");
    XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
    XLSX.writeFile(workbook, "MetalForge-Opening-Party-Balances.xlsx");
  };

  const parseFile = async (file: File) => {
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      if (!raw.length) throw new Error("The file has no opening balance rows.");

      const prepared: ImportRow[] = raw.map((record, index) => {
        const party_type = normalizePartyType(pick(record, ["Party Type", "Type", "PartyType"]));
        const name = text(pick(record, ["English Name", "Name", "Party Name", "Customer/Supplier Name"]));
        const name_urdu = text(pick(record, ["Urdu Name", "Name Urdu", "Urdu"]));
        const amountRaw = pick(record, ["Opening Balance", "Balance", "Amount", "Opening Amount"]);
        const amount = Number(String(amountRaw ?? "").replace(/,/g, ""));
        const side = normalizeSide(pick(record, ["Balance Side", "Side", "Dr/Cr", "Debit/Credit"]));
        const email = text(pick(record, ["Email", "E-mail"]));
        const phone = text(pick(record, ["Phone", "Mobile", "Contact"]));
        const address = text(pick(record, ["Address"]));
        let issue = "";
        if (!party_type) issue = "Party Type must be Customer or Supplier.";
        else if (!name) issue = "English Name is required.";
        else if (!Number.isFinite(amount) || amount <= 0) issue = "Opening Balance must be greater than zero.";
        else if (!side) issue = "Balance Side must be Debit/Dr or Credit/Cr.";
        return { rowNo: index + 2, party_type, name, name_urdu: name_urdu || (name ? toUrduName(name) : ""), amount: Number.isFinite(amount) ? amount : 0, side, email, phone, address, match: issue ? "invalid" : "new", issue };
      });

      const seen = new Map<string, number>();
      for (const row of prepared) {
        if (row.issue || !row.party_type) continue;
        const k = partyKey(row.party_type, row.name);
        if (seen.has(k)) {
          row.issue = `Duplicate of Excel row ${seen.get(k)}. Merge duplicate opening balances into one row.`;
          row.match = "invalid";
        } else seen.set(k, row.rowNo);
      }

      const [customers, suppliers] = await Promise.all([
        supabase.from("customers").select("name"),
        supabase.from("suppliers").select("name"),
      ]);
      if (customers.error) throw customers.error;
      if (suppliers.error) throw suppliers.error;
      const customerNames = new Set((customers.data ?? []).map((x) => partyKey("customer", x.name)));
      const supplierNames = new Set((suppliers.data ?? []).map((x) => partyKey("supplier", x.name)));
      for (const row of prepared) {
        if (row.issue || !row.party_type) continue;
        const existing = row.party_type === "customer" ? customerNames.has(partyKey("customer", row.name)) : supplierNames.has(partyKey("supplier", row.name));
        row.match = existing ? "existing" : "new";
      }

      setRows(prepared);
      setFileName(file.name);
    } catch (error) {
      setRows([]);
      setFileName("");
      setMessage(error instanceof Error ? error.message : "Could not read the file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const importAndPost = async () => {
    if (!isPlatformOwner || !activeCompany) return;
    if (!openingDate) return setMessage("Opening date is required.");
    if (!rows.length) return setMessage("Upload an Excel/CSV file first.");
    if (totals.invalid) return setMessage("Fix the invalid rows before importing.");
    if (!confirm(`Import and POST ${rows.length} party opening balances into ${activeCompany.company_name}? This will create new parties and a posted opening journal.`)) return;

    setBusy(true);
    setMessage("");
    setResult(null);
    const payload = rows.map(({ party_type, name, name_urdu, amount, side, email, phone, address }) => ({ party_type, name, name_urdu, amount, side, email, phone, address }));
    const { data, error } = await supabase.rpc("import_opening_party_balances", { p_opening_date: openingDate, p_rows: payload });
    setBusy(false);
    if (error) return setMessage(error.message);
    const next = data as ImportResult;
    setResult(next);
    setMessage(`Posted successfully as ${next.entry_no}.`);
  };

  if (!isPlatformOwner) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Software Platform Owner access is required.</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/owner" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><ArrowLeft size={14}/> Owner Control</Link>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600"><ShieldCheck size={16}/> Platform Owner Only</div>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Opening Party Balances</h1>
          <p className="mt-1 text-sm text-slate-500">Selected company: <b>{activeCompany?.company_name ?? "No company selected"}</b>. New names are created automatically with English + Urdu and balances are posted through AR/AP and Opening Balance Equity.</p>
        </div>
        <button type="button" className="btn" onClick={downloadTemplate}><Download size={16}/> Download Excel Template</button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>Protected migration tool:</b> company owners, admins, accountants and staff cannot use this screen or its database import function. Only the software platform owner can post opening migrations.</div>
      {message && <div className={`rounded-lg border px-3 py-2 text-sm ${result ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{message}</div>}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end">
          <label className="text-xs font-semibold text-slate-600">Opening Date<input type="date" className="input mt-1 w-full" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} /></label>
          <div><div className="text-xs font-semibold text-slate-600">Excel / CSV File</div><div className="mt-1 flex min-h-10 items-center rounded-lg border bg-slate-50 px-3 text-sm text-slate-600"><FileSpreadsheet size={16} className="mr-2"/>{fileName || "No file selected"}</div></div>
          <div><input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && void parseFile(e.target.files[0])}/><button type="button" className="btn-primary" disabled={busy || !activeCompany} onClick={() => inputRef.current?.click()}><Upload size={16}/> {busy ? "Reading..." : "Upload & Preview"}</button></div>
        </div>
      </section>

      {rows.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Rows</div><div className="text-lg font-bold">{rows.length}</div></div>
          <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">New Parties</div><div className="text-lg font-bold text-blue-700">{totals.newCount}</div></div>
          <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Existing Parties</div><div className="text-lg font-bold">{totals.existingCount}</div></div>
          <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Debit Total</div><div className="text-lg font-bold">{totals.debit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
          <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Credit Total</div><div className="text-lg font-bold">{totals.credit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
        </div>

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Excel Row</th><th className="px-3 py-2">Party Type</th><th className="px-3 py-2">English Name</th><th className="px-3 py-2 text-right">Urdu Name</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Side</th><th className="px-3 py-2">Match</th><th className="px-3 py-2">Validation</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rowNo} className={`border-t ${row.issue ? "bg-red-50" : ""}`}><td className="px-3 py-2">{row.rowNo}</td><td className="px-3 py-2 capitalize">{row.party_type || "—"}</td><td className="px-3 py-2 font-medium">{row.name || "—"}</td><td dir="rtl" className="px-3 py-2 text-right">{row.name_urdu || "—"}</td><td className="px-3 py-2 text-right font-mono">{row.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td className="px-3 py-2 uppercase">{row.side || "—"}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-1 font-semibold ${row.match === "new" ? "bg-blue-50 text-blue-700" : row.match === "existing" ? "bg-emerald-50 text-emerald-700" : "bg-red-100 text-red-700"}`}>{row.match}</span></td><td className="px-3 py-2 text-red-700">{row.issue || "OK"}</td></tr>)}</tbody></table></div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><div className="text-sm text-slate-500">{totals.invalid ? <span className="font-semibold text-red-600">{totals.invalid} invalid row(s) must be fixed.</span> : "Preview is valid. Posting will create one balanced opening journal and party sub-ledgers."}</div><button type="button" className="btn-primary" disabled={busy || totals.invalid > 0 || !activeCompany} onClick={() => void importAndPost()}><ShieldCheck size={16}/>{busy ? "Posting..." : "Import & Post Opening Balances"}</button></div>
        </section>
      </>}

      {result && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><h2 className="font-bold text-emerald-900">Migration Posted Successfully</h2><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-emerald-700">Journal</span><div className="font-bold">{result.entry_no}</div></div><div><span className="text-emerald-700">Rows Imported</span><div className="font-bold">{result.rows_imported}</div></div><div><span className="text-emerald-700">Customers New / Existing</span><div className="font-bold">{result.created_customers} / {result.existing_customers}</div></div><div><span className="text-emerald-700">Suppliers New / Existing</span><div className="font-bold">{result.created_suppliers} / {result.existing_suppliers}</div></div></div></section>}
    </div>
  );
}
