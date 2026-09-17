import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, ShieldCheck, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import SearchableSelect from "@/components/SearchableSelect";
import { supabase } from "@/lib/supabase";

type OrderType = "sales" | "purchase";
type Unit = { id: string; name: string; code: string; is_default: boolean };
type Location = { id: string; business_unit_id: string | null; name: string; code: string };
type Named = { id: string; name: string };
type ImportRow = {
  rowNo: number;
  order_no: string;
  order_date: string;
  party_name: string;
  salesperson_name: string;
  item_name: string;
  ordered_qty: number;
  fulfilled_qty: number;
  cancelled_qty: number;
  uom: string;
  rate_status: "pending" | "agreed" | "";
  agreed_rate: number | null;
  effective_date: string;
  order_remarks: string;
  line_remarks: string;
  issue: string;
};

type ImportResult = { orders_imported: number; lines_imported: number; order_type: OrderType };
const text = (value: unknown) => String(value ?? "").trim();
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const pick = (record: Record<string, unknown>, names: string[]) => {
  const wanted = new Set(names.map(key));
  for (const [header, value] of Object.entries(record)) if (wanted.has(key(header))) return value;
  return undefined;
};
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const excelDate = (value: unknown) => {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = text(value);
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString().slice(0, 10);
};

export default function OwnerOrderBookMigration({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [type, setType] = useState<OrderType>("sales");
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [parties, setParties] = useState<Named[]>([]);
  const [items, setItems] = useState<Named[]>([]);
  const [salespeople, setSalespeople] = useState<Named[]>([]);
  const [unitId, setUnitId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadMasters = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const partyTable = type === "sales" ? "customers" : "suppliers";
      const [u, l, p, i, e] = await Promise.all([
        supabase.from("business_units").select("id,name,code,is_default").eq("company_id", companyId).eq("is_active", true).order("is_default", { ascending: false }).order("name"),
        supabase.from("operating_locations").select("id,business_unit_id,name,code").eq("company_id", companyId).eq("is_active", true).order("name"),
        supabase.from(partyTable).select("id,name").eq("company_id", companyId).eq("is_active", true).order("name"),
        supabase.from("items").select("id,name").eq("company_id", companyId).order("name"),
        type === "sales" ? supabase.from("employees").select("id,name").eq("company_id", companyId).eq("is_active", true).order("name") : Promise.resolve({ data: [] as Named[], error: null }),
      ]);
      const first = u.error || l.error || p.error || i.error || e.error;
      if (first) throw first;
      const nextUnits = (u.data ?? []) as Unit[];
      setUnits(nextUnits); setLocations((l.data ?? []) as Location[]); setParties((p.data ?? []) as Named[]); setItems((i.data ?? []) as Named[]); setSalespeople((e.data ?? []) as Named[]);
      setUnitId(current => nextUnits.some(x => x.id === current) ? current : (nextUnits[0]?.id ?? ""));
      setLocationId(""); setRows([]); setFileName(""); setResult(null);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Could not load migration masters."); }
    finally { setBusy(false); }
  }, [companyId, type]);
  useEffect(() => { void loadMasters(); }, [loadMasters]);
  useEffect(() => { if (locationId && !locations.some(x => x.id === locationId && x.business_unit_id === unitId)) setLocationId(""); }, [locationId, locations, unitId]);

  const partyNames = useMemo(() => new Set(parties.map(x => nameKey(x.name))), [parties]);
  const itemNames = useMemo(() => new Set(items.map(x => nameKey(x.name))), [items]);
  const salespersonNames = useMemo(() => new Set(salespeople.map(x => nameKey(x.name))), [salespeople]);
  const branches = locations.filter(x => x.business_unit_id === unitId);
  const summary = useMemo(() => ({
    orders: new Set(rows.filter(x => !x.issue).map(x => x.order_no)).size,
    lines: rows.length,
    invalid: rows.filter(x => x.issue).length,
    openQty: rows.filter(x => !x.issue).reduce((sum, x) => sum + Math.max(0, x.ordered_qty - x.fulfilled_qty - x.cancelled_qty), 0),
  }), [rows]);

  const downloadTemplate = () => {
    const headers = [["Order No", "Order Date", type === "sales" ? "Customer Name" : "Supplier Name", "Salesperson Name", "Item Name", "Ordered Qty", "Fulfilled Qty", "Cancelled Qty", "UOM", "Rate Status", "Agreed Rate", "Effective Date", "Order Remarks", "Line Remarks"]];
    const sample = [[type === "sales" ? "SOB-OLD-001" : "POB-OLD-001", new Date().toISOString().slice(0,10), type === "sales" ? "Existing Customer" : "Existing Supplier", type === "sales" ? "Existing Salesperson" : "", "Existing Item", 1000, 0, 0, "kg", "agreed", 250, new Date().toISOString().slice(0,10), "Legacy pending booking", ""]];
    const sheet = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
    sheet["!cols"] = [18,14,30,24,30,14,14,14,10,14,14,14,30,30].map(wch => ({ wch }));
    const instructions = XLSX.utils.aoa_to_sheet([
      ["NAVILO Order Book Migration - Platform Owner Only"],
      ["Purpose", "Imports old Sales/Purchase Order Booking commitments only. It does NOT post stock, VAT, AP/AR or General Ledger."],
      ["Master matching", "Customer/Supplier, Item and Salesperson names must already exist in the selected company and match by name."],
      ["Multiple lines", "Repeat the same Order No, Order Date, Party and Salesperson on each item line of one order."],
      ["Quantities", "Ordered Qty > 0. Fulfilled and Cancelled must be >= 0 and together cannot exceed Ordered Qty."],
      ["Rate Status", "Use agreed or pending. Agreed requires a positive Agreed Rate; pending leaves rate blank."],
      ["Order No", "Required and must not already exist in the selected business unit."],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, type === "sales" ? "Sales Order Book" : "Purchase Order Book"); XLSX.utils.book_append_sheet(wb, instructions, "Instructions");
    XLSX.writeFile(wb, `NAVILO-${type === "sales" ? "Sales" : "Purchase"}-Order-Book-Migration.xlsx`);
  };

  const parseFile = async (file: File) => {
    setBusy(true); setMessage(""); setResult(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!raw.length) throw new Error("The file has no Order Book rows.");
      const prepared: ImportRow[] = raw.map((r, index) => {
        const order_no = text(pick(r, ["Order No","Order Number","Booking No"]));
        const order_date = excelDate(pick(r, ["Order Date","Booking Date","Date"]));
        const party_name = text(pick(r, type === "sales" ? ["Customer Name","Party Name","Customer"] : ["Supplier Name","Party Name","Supplier","Vendor Name"]));
        const salesperson_name = text(pick(r, ["Salesperson Name","Sales Person","Salesperson"]));
        const item_name = text(pick(r, ["Item Name","Item","Product Name"]));
        const ordered_qty = number(pick(r, ["Ordered Qty","Order Qty","Qty","Quantity"]), NaN);
        const fulfilled_qty = number(pick(r, ["Fulfilled Qty","Delivered Qty","Received Qty"]), 0);
        const cancelled_qty = number(pick(r, ["Cancelled Qty","Canceled Qty"]), 0);
        const uom = text(pick(r, ["UOM","Unit"])) || "kg";
        const rate_status_raw = text(pick(r, ["Rate Status","RateStatus"])).toLowerCase() || "pending";
        const rate_status = (rate_status_raw === "pending" || rate_status_raw === "agreed") ? rate_status_raw : "";
        const rawRate = pick(r, ["Agreed Rate","Rate","Unit Rate"]); const agreed_rate = text(rawRate) ? number(rawRate, NaN) : null;
        const effective_date = excelDate(pick(r, ["Effective Date","Rate Date"])) || order_date;
        const order_remarks = text(pick(r, ["Order Remarks","Header Remarks"]));
        const line_remarks = text(pick(r, ["Line Remarks","Remarks"]));
        let issue = "";
        if (!order_no) issue = "Order No is required.";
        else if (!order_date || Number.isNaN(new Date(order_date).getTime())) issue = "Valid Order Date is required.";
        else if (!party_name) issue = `${type === "sales" ? "Customer" : "Supplier"} Name is required.`;
        else if (!partyNames.has(nameKey(party_name))) issue = `${type === "sales" ? "Customer" : "Supplier"} not found in selected company.`;
        else if (type === "sales" && (!salesperson_name || !salespersonNames.has(nameKey(salesperson_name)))) issue = "Salesperson not found in selected company.";
        else if (!item_name || !itemNames.has(nameKey(item_name))) issue = "Item not found in selected company.";
        else if (!Number.isFinite(ordered_qty) || ordered_qty <= 0) issue = "Ordered Qty must be greater than zero.";
        else if (fulfilled_qty < 0 || cancelled_qty < 0 || fulfilled_qty + cancelled_qty > ordered_qty) issue = "Fulfilled/Cancelled Qty is invalid.";
        else if (!rate_status) issue = "Rate Status must be agreed or pending.";
        else if (rate_status === "agreed" && (!Number.isFinite(agreed_rate) || Number(agreed_rate) <= 0)) issue = "Agreed Rate must be greater than zero.";
        return { rowNo:index+2, order_no, order_date, party_name, salesperson_name, item_name, ordered_qty, fulfilled_qty, cancelled_qty, uom, rate_status, agreed_rate:Number.isFinite(agreed_rate as number)?agreed_rate:null, effective_date, order_remarks, line_remarks, issue };
      });
      const firstByOrder = new Map<string, ImportRow>();
      for (const row of prepared) {
        const k = nameKey(row.order_no); if (!k) continue; const first = firstByOrder.get(k);
        if (!first) firstByOrder.set(k, row);
        else if (!row.issue && (nameKey(row.party_name) !== nameKey(first.party_name) || row.order_date !== first.order_date || (type === "sales" && nameKey(row.salesperson_name) !== nameKey(first.salesperson_name)))) row.issue = `Header mismatch with Excel row ${first.rowNo} for the same Order No.`;
      }
      setRows(prepared); setFileName(file.name);
    } catch (caught) { setRows([]); setFileName(""); setMessage(caught instanceof Error ? caught.message : "Could not read migration file."); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const importRows = async () => {
    if (!unitId) return setMessage("Select a business unit first.");
    if (!rows.length) return setMessage("Upload and preview a migration file first.");
    if (summary.invalid) return setMessage("Fix all invalid rows before importing.");
    if (!window.confirm(`Import ${summary.orders} ${type} Order Book orders (${rows.length} lines) into ${companyName}? No stock or accounting posting will occur.`)) return;
    setBusy(true); setMessage(""); setResult(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser(); if (authError || !authData.user) throw authError ?? new Error("Authentication required.");
      const payload = rows.map(({ rowNo, issue, ...row }) => row);
      const { data, error } = await supabase.rpc("platform_import_order_book", { p_company_id:companyId, p_business_unit_id:unitId, p_operating_location_id:locationId || null, p_order_type:type, p_rows:payload, p_actor_id:authData.user.id });
      if (error) throw error;
      const next = data as ImportResult; setResult(next); setRows([]); setFileName(""); setMessage(`Imported ${next.orders_imported} orders and ${next.lines_imported} lines successfully.`);
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Order Book migration failed."); }
    finally { setBusy(false); }
  };

  return <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-700"/><h2 className="font-semibold text-slate-900">Opening Sales / Purchase Order Book Migration</h2></div><p className="mt-1 text-xs text-slate-500">Platform Owner migration for legacy pending bookings. Commitments only — no stock, VAT, payable/receivable or GL posting.</p></div><div className="flex gap-2"><button className={type === "sales" ? "btn-primary" : "btn-secondary"} onClick={()=>setType("sales")}>Sales Order Book</button><button className={type === "purchase" ? "btn-primary" : "btn-secondary"} onClick={()=>setType("purchase")}>Purchase Order Book</button></div></div>
    {message && <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${result ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{message}</div>}
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end"><label className="text-xs font-semibold text-slate-600">Business Unit<SearchableSelect className="input mt-1 w-full" value={unitId} onChange={e=>setUnitId(e.target.value)}>{units.map(u=><option key={u.id} value={u.id} data-search={u.code}>{u.name}</option>)}</SearchableSelect></label><label className="text-xs font-semibold text-slate-600">Branch / Location<SearchableSelect className="input mt-1 w-full" value={locationId} onChange={e=>setLocationId(e.target.value)}><option value="">Whole business</option>{branches.map(l=><option key={l.id} value={l.id} data-search={l.code}>{l.name}</option>)}</SearchableSelect></label><button className="btn-secondary" disabled={busy} onClick={downloadTemplate}><Download className="h-4 w-4"/>Template</button><div><input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&void parseFile(e.target.files[0])}/><button className="btn-primary" disabled={busy||!unitId} onClick={()=>inputRef.current?.click()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Upload className="h-4 w-4"/>}Upload & Preview</button></div></div>
    {fileName && <div className="mt-3 flex items-center gap-2 text-xs text-slate-600"><FileSpreadsheet className="h-4 w-4"/>{fileName}</div>}
    {rows.length>0&&<><div className="mt-4 grid gap-3 sm:grid-cols-4"><Stat label="Orders" value={summary.orders}/><Stat label="Lines" value={summary.lines}/><Stat label="Open Qty" value={summary.openQty}/><Stat label="Invalid" value={summary.invalid}/></div><div className="mt-3 max-h-72 overflow-auto rounded-lg border"><table className="w-full min-w-[1100px] text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2 text-left">Row</th><th className="p-2 text-left">Order</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Party</th>{type==="sales"&&<th className="p-2 text-left">Salesperson</th>}<th className="p-2 text-left">Item</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Fulfilled</th><th className="p-2 text-right">Cancelled</th><th className="p-2 text-left">Rate</th><th className="p-2 text-left">Validation</th></tr></thead><tbody>{rows.map(r=><tr key={r.rowNo} className={`border-t ${r.issue?"bg-red-50":""}`}><td className="p-2">{r.rowNo}</td><td className="p-2 font-semibold">{r.order_no}</td><td className="p-2">{r.order_date}</td><td className="p-2">{r.party_name}</td>{type==="sales"&&<td className="p-2">{r.salesperson_name}</td>}<td className="p-2">{r.item_name}</td><td className="p-2 text-right">{r.ordered_qty}</td><td className="p-2 text-right">{r.fulfilled_qty}</td><td className="p-2 text-right">{r.cancelled_qty}</td><td className="p-2">{r.rate_status}{r.rate_status==="agreed"?` @ ${r.agreed_rate}`:""}</td><td className={`p-2 ${r.issue?"font-semibold text-red-700":"text-emerald-700"}`}>{r.issue||"Ready"}</td></tr>)}</tbody></table></div><button className="btn-primary mt-3" disabled={busy||summary.invalid>0} onClick={()=>void importRows()}>{busy&&<Loader2 className="h-4 w-4 animate-spin"/>}Import {type === "sales" ? "Sales" : "Purchase"} Order Book</button></>}
  </section>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border bg-slate-50 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div><div className="text-lg font-bold text-slate-900">{Number(value).toLocaleString()}</div></div>; }
