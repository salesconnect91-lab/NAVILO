import { useEffect, useMemo, useRef, useState } from "react";
import { Settings2, Upload, FileText } from "lucide-react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";

const buttonClass = "inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50";

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])));
}

function downloadCsv(filename: string, headers: string[], example: string[]) {
  const esc = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  const content = `${headers.map(esc).join(",")}\n${example.map(esc).join(",")}\n`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

function norm(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
function num(value: unknown) { return Number(value) || 0; }
function today() { return new Date().toISOString().slice(0, 10); }
function generated(prefix: string, index: number) { return `${prefix}-IMPORT-${Date.now()}-${index + 1}`; }

export default function ConsolidatedInvoiceTools() {
  const { pathname } = useLocation();
  const isSales = pathname === "/sales/consolidated";
  const isPurchase = pathname === "/purchase/consolidated";
  const active = isSales || isPurchase;
  const [importOpen, setImportOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hidden, setHidden] = useState<number[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const storageKey = `navilo:consolidated-columns:${pathname}`;

  useEffect(() => {
    if (!active) return;
    try { setHidden(JSON.parse(localStorage.getItem(storageKey) || "[]")); } catch { setHidden([]); }
  }, [active, storageKey]);

  const listTable = () => {
    const main = document.querySelector<HTMLElement>("#navilo-main-content");
    if (!main) return null;
    const tables = Array.from(main.querySelectorAll<HTMLTableElement>("table"));
    if (isSales) return tables.find((table) => norm(table.querySelector("thead")?.textContent).includes("hawala no")) ?? null;
    return tables.find((table) => {
      const head = norm(table.querySelector("thead")?.textContent);
      return head.includes("invoice") && head.includes("supplier") && head.includes("status") && head.includes("total");
    }) ?? null;
  };

  const columns = useMemo(() => {
    if (!active) return [];
    const table = listTable();
    const cells = table ? Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th")) : [];
    return cells.map((cell, index) => ({ index, label: cell.textContent?.trim() || `Column ${index + 1}` })).filter((column) => !/action/i.test(column.label));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pathname, customizeOpen]);

  useEffect(() => {
    if (!active) return;
    const apply = () => {
      const table = listTable();
      if (!table) return;
      const hiddenSet = new Set(hidden);
      table.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr) => {
        Array.from(tr.children).forEach((cell, index) => {
          (cell as HTMLElement).style.display = hiddenSet.has(index) ? "none" : "";
        });
      });
    };
    apply();
    const main = document.querySelector<HTMLElement>("#navilo-main-content");
    if (!main) return;
    const observer = new MutationObserver(apply);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, hidden, pathname]);

  const persistHidden = (next: number[]) => {
    setHidden(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const downloadTemplate = () => {
    if (isSales) {
      downloadCsv("consolidated-sales-import-template.csv", ["Invoice No","Invoice Date","Customer","Reference Name","Reference No","Item","Godown","Qty","Rate","Invoice Type"], ["","2026-09-14","Customer Name","Hawala Name","REF-001","Item Name","Godown No. 1","1","1000","Without Tax"]);
    } else {
      downloadCsv("consolidated-purchase-import-template.csv", ["Invoice No","Invoice Date","Supplier","Reference Name","Reference No","Item","Godown","Qty","Unit Cost","Invoice Type"], ["","2026-09-14","Supplier Name","Delivery Ref","REF-001","Item Name","Godown No. 1","1","1000","Without Tax"]);
    }
    setImportOpen(false);
  };

  const importSales = async (rows: CsvRow[]) => {
    const [customersRes, itemsRes, godownsRes, taxRes] = await Promise.all([
      supabase.from("customers").select("id,name"),
      supabase.from("items").select("id,name,sku"),
      supabase.from("godowns").select("id,name"),
      supabase.from("tax_rates").select("rate").eq("is_active", true).eq("is_fixed", true).in("applies_to", ["sales", "both"]).order("created_at").limit(1).maybeSingle(),
    ]);
    const firstError = customersRes.error || itemsRes.error || godownsRes.error || taxRes.error; if (firstError) throw firstError;
    const customers = new Map((customersRes.data ?? []).map((r: any) => [norm(r.name), r.id]));
    const items = new Map<string,string>(); (itemsRes.data ?? []).forEach((r: any) => { items.set(norm(r.name), r.id); if (r.sku) items.set(norm(r.sku), r.id); });
    const godowns = new Map((godownsRes.data ?? []).map((r: any) => [norm(r.name), r.id]));
    const fixedTax = num(taxRes.data?.rate);
    const groups = new Map<string, CsvRow[]>();
    rows.forEach((r, i) => { const key = r["Invoice No"] || generated("HWL", i); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(r); });
    let imported = 0;
    for (const [invoiceNo, group] of groups) {
      const first = group[0]; const customerId = customers.get(norm(first["Customer"])); if (!customerId) throw new Error(`Customer not found: ${first["Customer"]}`);
      const withTax = norm(first["Invoice Type"]).includes("with") || norm(first["Invoice Type"]).includes("tax invoice");
      if (withTax && !fixedTax) throw new Error("Fixed Sales VAT rate is not configured.");
      const lines = group.map((r) => {
        const itemId = items.get(norm(r["Item"])); const godownId = godowns.get(norm(r["Godown"]));
        if (!itemId) throw new Error(`Item not found: ${r["Item"]}`); if (!godownId) throw new Error(`Godown not found: ${r["Godown"]}`);
        const qty = num(r["Qty"]), rate = num(r["Rate"]); if (qty <= 0) throw new Error(`Qty must be greater than zero for ${r["Item"]}`);
        return { item_id: itemId, godown_id: godownId, qty, unit_price: rate, tax_percent: withTax ? fixedTax : 0, description: null, line_total: qty * rate };
      });
      const subtotal = lines.reduce((s, r) => s + r.line_total, 0); const itemTax = withTax ? lines.reduce((s, r) => s + r.line_total * r.tax_percent / 100, 0) : 0;
      const { data: header, error } = await supabase.from("consolidated_sales_invoices").insert({ invoice_no: invoiceNo, invoice_date: first["Invoice Date"] || today(), customer_id: customerId, reference_name: first["Reference Name"] || "Imported", reference_no: first["Reference No"] || null, reference_notes: null, invoice_type: withTax ? "Tax Invoice" : "Sale Invoice", tax_percent: withTax ? fixedTax : 0, subtotal, item_tax: itemTax, charges_total: 0, charge_tax: 0, total: subtotal + itemTax, status: "draft" }).select("id").single();
      if (error) throw error;
      const { error: lineError } = await supabase.from("consolidated_sales_invoice_lines").insert(lines.map((line) => ({ ...line, invoice_id: header.id })));
      if (lineError) throw lineError; imported += 1;
    }
    return imported;
  };

  const importPurchase = async (rows: CsvRow[]) => {
    const [suppliersRes, itemsRes, godownsRes, taxRes] = await Promise.all([
      supabase.from("suppliers").select("id,name").eq("is_active", true),
      supabase.from("items").select("id,name,sku"),
      supabase.from("godowns").select("id,name"),
      supabase.from("tax_rates").select("rate").eq("is_active", true).eq("is_fixed", true).in("applies_to", ["purchase", "both"]).order("created_at").limit(1).maybeSingle(),
    ]);
    const firstError = suppliersRes.error || itemsRes.error || godownsRes.error || taxRes.error; if (firstError) throw firstError;
    const suppliers = new Map((suppliersRes.data ?? []).map((r: any) => [norm(r.name), r.id]));
    const items = new Map<string,string>(); (itemsRes.data ?? []).forEach((r: any) => { items.set(norm(r.name), r.id); if (r.sku) items.set(norm(r.sku), r.id); });
    const godowns = new Map((godownsRes.data ?? []).map((r: any) => [norm(r.name), r.id]));
    const fixedTax = num(taxRes.data?.rate);
    const groups = new Map<string, CsvRow[]>();
    rows.forEach((r, i) => { const key = r["Invoice No"] || generated("CP", i); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(r); });
    let imported = 0;
    for (const [invoiceNo, group] of groups) {
      const first = group[0]; const supplierId = suppliers.get(norm(first["Supplier"])); if (!supplierId) throw new Error(`Supplier not found: ${first["Supplier"]}`);
      const withTax = norm(first["Invoice Type"]).includes("with") || norm(first["Invoice Type"]).includes("tax invoice");
      if (withTax && !fixedTax) throw new Error("Fixed Purchase VAT rate is not configured.");
      const lines = group.map((r) => {
        const itemId = items.get(norm(r["Item"])); const godownId = godowns.get(norm(r["Godown"]));
        if (!itemId) throw new Error(`Item not found: ${r["Item"]}`); if (!godownId) throw new Error(`Godown not found: ${r["Godown"]}`);
        const qty = num(r["Qty"]), cost = num(r["Unit Cost"]); if (qty <= 0) throw new Error(`Qty must be greater than zero for ${r["Item"]}`);
        return { item_id: itemId, godown_id: godownId, qty, unit_cost: cost, tax_percent: withTax ? fixedTax : 0, description: null, line_total: qty * cost, order_book_commitment_id: null };
      });
      const subtotal = lines.reduce((s, r) => s + r.line_total, 0); const itemTax = withTax ? lines.reduce((s, r) => s + r.line_total * r.tax_percent / 100, 0) : 0;
      const { data: header, error } = await supabase.from("consolidated_purchase_invoices").insert({ invoice_no: invoiceNo, invoice_date: first["Invoice Date"] || today(), supplier_id: supplierId, reference_name: first["Reference Name"] || null, reference_no: first["Reference No"] || null, reference_notes: null, invoice_type: withTax ? "Tax Invoice" : "Purchase Invoice", tax_percent: withTax ? fixedTax : 0, subtotal, item_tax: itemTax, charges_total: 0, charge_tax: 0, total: subtotal + itemTax, status: "draft" }).select("id").single();
      if (error) throw error;
      const { error: lineError } = await supabase.from("consolidated_purchase_invoice_lines").insert(lines.map((line) => ({ ...line, invoice_id: header.id })));
      if (lineError) throw lineError; imported += 1;
    }
    return imported;
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const parsed = parseCsv(await file.text()); if (!parsed.length) throw new Error("CSV file has no import rows.");
      const count = isSales ? await importSales(parsed) : await importPurchase(parsed);
      setMessage(`${count} draft consolidated document${count === 1 ? "" : "s"} imported successfully.`);
      setImportOpen(false);
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error: any) { setMessage(error?.message || "Import failed."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  if (!active) return null;

  return <>
    <div className="relative flex items-center gap-2" data-no-print data-no-export>
      <button type="button" className={buttonClass} onClick={() => setCustomizeOpen(true)}><Settings2 className="h-4 w-4" />Customize</button>
      <div className="relative">
        <button type="button" className={buttonClass} onClick={() => setImportOpen((value) => !value)}><Upload className="h-4 w-4" />Import</button>
        {importOpen && <div className="absolute right-0 top-10 z-[90] w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          <button type="button" onClick={downloadTemplate} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"><FileText className="h-4 w-4" />Download Template</button>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-50"><Upload className="h-4 w-4" />{busy ? "Importing…" : "Choose CSV / Upload"}</button>
        </div>}
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void onFile(event.target.files?.[0] ?? null)} />
    </div>

    {message && <div className="fixed bottom-5 right-5 z-[150] max-w-sm rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-xl">{message}</div>}

    {customizeOpen && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/30 p-4" data-no-print data-no-export>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-bold text-slate-900">Customize Columns</h3><p className="mt-1 text-xs text-slate-500">Choose columns shown on the consolidated list.</p></div><button type="button" className="btn-secondary" onClick={() => setCustomizeOpen(false)}>Close</button></div>
        <div className="mt-4 max-h-[50vh] space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
          {columns.map((column) => <label key={column.index} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={!hidden.includes(column.index)} onChange={() => persistHidden(hidden.includes(column.index) ? hidden.filter((index) => index !== column.index) : [...hidden, column.index])} /><span className="min-w-0 flex-1 text-slate-700">{column.label}</span></label>)}
        </div>
        <div className="mt-4 flex items-center justify-between"><button type="button" className="btn-secondary" onClick={() => persistHidden([])}>Show All</button><button type="button" className="btn-primary" onClick={() => setCustomizeOpen(false)}>Done</button></div>
      </div>
    </div>}
  </>;
}
