import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, formatCurrency } from "@/components/ui";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";

const n = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

type SalesFact = {
  salesperson_id: string; sales_person: string; invoice_id: string; invoice_no: string; order_date: string;
  customer_id: string | null; customer_name: string | null; invoice_type: string | null; settlement_type: string | null;
  gross_sales: number; returns: number; net_sales: number; vat_amount: number; tax_invoice_total: number; without_tax_total: number;
  cash_business: number; bank_business: number; credit_business: number; received: number; outstanding: number;
  actual_cogs: number; gross_profit: number; margin_percent: number;
};

type PurchaseFact = {
  purchase_person_id: string; purchase_person: string; invoice_id: string; invoice_no: string; order_date: string;
  supplier_id: string | null; supplier_name: string | null; invoice_type: string | null;
  item_value: number; charges: number; vat_amount: number; gross_purchase: number; tax_invoice_total: number; without_tax_total: number;
  paid: number; outstanding: number;
};

type SalesSummary = {
  id: string; name: string; party?: string; invoices: number; gross: number; returns: number; net: number; withoutTax: number; tax: number;
  vat: number; cash: number; bank: number; credit: number; received: number; outstanding: number; cogs: number; gp: number; margin: number;
};

type PurchaseSummary = {
  id: string; name: string; party?: string; invoices: number; gross: number; withoutTax: number; tax: number; vat: number;
  itemValue: number; charges: number; paid: number; outstanding: number;
};

function salesAggregate(rows: SalesFact[], party = false): SalesSummary[] {
  const map = new Map<string, SalesSummary>();
  for (const r of rows) {
    const partyId = party ? (r.customer_id || r.customer_name || "no-party") : "all";
    const key = `${r.salesperson_id}:${partyId}`;
    const row = map.get(key) || { id: r.salesperson_id, name: r.sales_person || "Unassigned", party: party ? (r.customer_name || "Unknown Customer") : undefined, invoices: 0, gross: 0, returns: 0, net: 0, withoutTax: 0, tax: 0, vat: 0, cash: 0, bank: 0, credit: 0, received: 0, outstanding: 0, cogs: 0, gp: 0, margin: 0 };
    row.invoices += 1; row.gross += n(r.gross_sales); row.returns += n(r.returns); row.net += n(r.net_sales); row.withoutTax += n(r.without_tax_total);
    row.tax += n(r.tax_invoice_total); row.vat += n(r.vat_amount); row.cash += n(r.cash_business); row.bank += n(r.bank_business); row.credit += n(r.credit_business);
    row.received += n(r.received); row.outstanding += n(r.outstanding); row.cogs += n(r.actual_cogs); row.gp += n(r.gross_profit);
    map.set(key, row);
  }
  return Array.from(map.values()).map(r => ({ ...r, margin: r.net ? (r.gp * 100) / r.net : 0 })).sort((a, b) => a.name.localeCompare(b.name) || (a.party || "").localeCompare(b.party || ""));
}

function purchaseAggregate(rows: PurchaseFact[], party = false): PurchaseSummary[] {
  const map = new Map<string, PurchaseSummary>();
  for (const r of rows) {
    const partyId = party ? (r.supplier_id || r.supplier_name || "no-party") : "all";
    const key = `${r.purchase_person_id}:${partyId}`;
    const row = map.get(key) || { id: r.purchase_person_id, name: r.purchase_person || "Unassigned", party: party ? (r.supplier_name || "Unknown Supplier") : undefined, invoices: 0, gross: 0, withoutTax: 0, tax: 0, vat: 0, itemValue: 0, charges: 0, paid: 0, outstanding: 0 };
    row.invoices += 1; row.gross += n(r.gross_purchase); row.withoutTax += n(r.without_tax_total); row.tax += n(r.tax_invoice_total); row.vat += n(r.vat_amount);
    row.itemValue += n(r.item_value); row.charges += n(r.charges); row.paid += n(r.paid); row.outstanding += n(r.outstanding);
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name) || (a.party || "").localeCompare(b.party || ""));
}

export default function SalespersonReport() {
  const [mode, setMode] = useState<"sales" | "purchase">("sales");
  const [sales, setSales] = useState<SalesFact[]>([]);
  const [purchases, setPurchases] = useState<PurchaseFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState("");
  const [invoiceType, setInvoiceType] = useState<"all" | "without" | "tax">("all");
  const [settlement, setSettlement] = useState<"all" | "cash" | "bank" | "credit">("all");
  const [showParties, setShowParties] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s,p]=await Promise.all([
        fetchAllPages<SalesFact>((fromRow,toRow)=>
          supabase
            .from("salesperson_business_performance_report")
            .select("*")
            .order("order_date",{ascending:false})
            .range(fromRow,toRow)
        ),

        fetchAllPages<PurchaseFact>((fromRow,toRow)=>
          supabase
            .from("purchaseperson_business_performance_report")
            .select("*")
            .order("order_date",{ascending:false})
            .range(fromRow,toRow)
        )
      ]);

      setSales(s);
      setPurchases(p);

    } catch(err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load person performance reports."
      );
      setSales([]);
      setPurchases([]);
    } setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const salesFiltered = useMemo(() => sales.filter(r => {
    if (from && r.order_date < from) return false; if (to && r.order_date > to) return false;
    if (invoiceType === "tax" && r.invoice_type !== "Tax Invoice") return false;
    if (invoiceType === "without" && r.invoice_type === "Tax Invoice") return false;
    if (settlement !== "all" && (r.settlement_type || "").toLowerCase() !== settlement) return false;
    const q = search.trim().toLowerCase(); return !q || `${r.sales_person} ${r.customer_name || ""} ${r.invoice_no}`.toLowerCase().includes(q);
  }), [sales, from, to, invoiceType, settlement, search]);

  const purchaseFiltered = useMemo(() => purchases.filter(r => {
    if (from && r.order_date < from) return false; if (to && r.order_date > to) return false;
    if (invoiceType === "tax" && r.invoice_type !== "Tax Invoice") return false;
    if (invoiceType === "without" && r.invoice_type === "Tax Invoice") return false;
    const q = search.trim().toLowerCase(); return !q || `${r.purchase_person} ${r.supplier_name || ""} ${r.invoice_no}`.toLowerCase().includes(q);
  }), [purchases, from, to, invoiceType, search]);

  const salesSummary = useMemo(() => salesAggregate(salesFiltered), [salesFiltered]);
  const salesParty = useMemo(() => salesAggregate(salesFiltered, true), [salesFiltered]);
  const purchaseSummary = useMemo(() => purchaseAggregate(purchaseFiltered), [purchaseFiltered]);
  const purchaseParty = useMemo(() => purchaseAggregate(purchaseFiltered, true), [purchaseFiltered]);

  const sTotals = useMemo(() => salesAggregate([{ salesperson_id: "TOTAL", sales_person: "TOTAL", invoice_id: "", invoice_no: "", order_date: "", customer_id: null, customer_name: null, invoice_type: null, settlement_type: null, gross_sales: salesFiltered.reduce((a,r)=>a+n(r.gross_sales),0), returns: salesFiltered.reduce((a,r)=>a+n(r.returns),0), net_sales: salesFiltered.reduce((a,r)=>a+n(r.net_sales),0), vat_amount: salesFiltered.reduce((a,r)=>a+n(r.vat_amount),0), tax_invoice_total: salesFiltered.reduce((a,r)=>a+n(r.tax_invoice_total),0), without_tax_total: salesFiltered.reduce((a,r)=>a+n(r.without_tax_total),0), cash_business: salesFiltered.reduce((a,r)=>a+n(r.cash_business),0), bank_business: salesFiltered.reduce((a,r)=>a+n(r.bank_business),0), credit_business: salesFiltered.reduce((a,r)=>a+n(r.credit_business),0), received: salesFiltered.reduce((a,r)=>a+n(r.received),0), outstanding: salesFiltered.reduce((a,r)=>a+n(r.outstanding),0), actual_cogs: salesFiltered.reduce((a,r)=>a+n(r.actual_cogs),0), gross_profit: salesFiltered.reduce((a,r)=>a+n(r.gross_profit),0), margin_percent: 0 }])[0], [salesFiltered]);
  const pTotals = useMemo(() => purchaseAggregate([{ purchase_person_id: "TOTAL", purchase_person: "TOTAL", invoice_id: "", invoice_no: "", order_date: "", supplier_id: null, supplier_name: null, invoice_type: null, item_value: purchaseFiltered.reduce((a,r)=>a+n(r.item_value),0), charges: purchaseFiltered.reduce((a,r)=>a+n(r.charges),0), vat_amount: purchaseFiltered.reduce((a,r)=>a+n(r.vat_amount),0), gross_purchase: purchaseFiltered.reduce((a,r)=>a+n(r.gross_purchase),0), tax_invoice_total: purchaseFiltered.reduce((a,r)=>a+n(r.tax_invoice_total),0), without_tax_total: purchaseFiltered.reduce((a,r)=>a+n(r.without_tax_total),0), paid: purchaseFiltered.reduce((a,r)=>a+n(r.paid),0), outstanding: purchaseFiltered.reduce((a,r)=>a+n(r.outstanding),0) }])[0], [purchaseFiltered]);

  const filterLabel = `${from || "Beginning"} to ${to || "Today"} ┬╖ ${invoiceType === "all" ? "All invoice types" : invoiceType === "tax" ? "With Tax" : "Without Tax"}${mode === "sales" ? ` ┬╖ ${settlement === "all" ? "All settlement types" : settlement}` : ""}`;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-bold">Sales & Purchase Person Performance</h1><p className="text-xs text-slate-500">Posted business only. Sales margin uses actual posted COGS; purchase report does not invent a profit margin.</p></div><button className="btn-secondary no-print" onClick={() => void load()}><RefreshCw className="h-4 w-4"/>Refresh</button></div>
    {error && <ErrorBanner message={error}/>} 
    <div className="no-print flex gap-2"><button className={mode === "sales" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("sales")}>Sales Person</button><button className={mode === "purchase" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("purchase")}>Purchase Person / Buyer</button></div>
    <div className="grid gap-2 rounded-lg border bg-white p-3 md:grid-cols-6 no-print">
      <label className="text-xs">From<input type="date" className="input mt-1 w-full" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="text-xs">To<input type="date" className="input mt-1 w-full" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <label className="text-xs">Invoice Type<select className="input mt-1 w-full" value={invoiceType} onChange={e=>setInvoiceType(e.target.value as any)}><option value="all">All</option><option value="without">Without Tax</option><option value="tax">With Tax</option></select></label>
      {mode === "sales" ? <label className="text-xs">Settlement<select className="input mt-1 w-full" value={settlement} onChange={e=>setSettlement(e.target.value as any)}><option value="all">All</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="credit">Credit</option></select></label> : <div/>}
      <label className="text-xs md:col-span-2">Search<input className="input mt-1 w-full" placeholder={mode === "sales" ? "Person, customer, invoiceΓÇª" : "Buyer, supplier, invoiceΓÇª"} value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showParties} onChange={e=>setShowParties(e.target.checked)}/> Party-wise detail</label>
    </div>
    <div data-report-filters className="text-xs text-slate-500">Applied filters: {filterLabel}</div>
    {loading ? <div className="p-8 text-center text-slate-400">LoadingΓÇª</div> : mode === "sales" ? <>
      <div className="grid gap-2 md:grid-cols-4"><div className="summary-card"><div className="summary-label">Net Sales</div><div className="summary-value">{formatCurrency(sTotals?.net || 0)}</div></div><div className="summary-card"><div className="summary-label">Gross Profit</div><div className="summary-value">{formatCurrency(sTotals?.gp || 0)}</div></div><div className="summary-card"><div className="summary-label">Received</div><div className="summary-value">{formatCurrency(sTotals?.received || 0)}</div></div><div className="summary-card"><div className="summary-label">Outstanding</div><div className="summary-value">{formatCurrency(sTotals?.outstanding || 0)}</div></div></div>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full whitespace-nowrap text-xs"><thead><tr><th>Sales Person / Customer</th><th className="text-right">Invoices</th><th className="text-right">Without Tax</th><th className="text-right">With Tax</th><th className="text-right">VAT</th><th className="text-right">Net Sales</th><th className="text-right">Cash</th><th className="text-right">Bank</th><th className="text-right">Credit</th><th className="text-right">Received</th><th className="text-right">Outstanding</th><th className="text-right">Actual COGS</th><th className="text-right">Gross Profit</th><th className="text-right">Margin %</th></tr></thead><tbody>{salesSummary.flatMap(r => [<tr key={r.id} className="font-semibold"><td>{r.name}</td><td className="text-right">{r.invoices}</td><td className="text-right">{formatCurrency(r.withoutTax)}</td><td className="text-right">{formatCurrency(r.tax)}</td><td className="text-right">{formatCurrency(r.vat)}</td><td className="text-right">{formatCurrency(r.net)}</td><td className="text-right">{formatCurrency(r.cash)}</td><td className="text-right">{formatCurrency(r.bank)}</td><td className="text-right">{formatCurrency(r.credit)}</td><td className="text-right">{formatCurrency(r.received)}</td><td className="text-right">{formatCurrency(r.outstanding)}</td><td className="text-right">{formatCurrency(r.cogs)}</td><td className="text-right">{formatCurrency(r.gp)}</td><td className="text-right">{r.margin.toFixed(2)}%</td></tr>, ...(showParties ? salesParty.filter(p=>p.id===r.id).map(p=><tr key={`${p.id}:${p.party}`} className="text-slate-600"><td className="pl-8">Γå│ {p.party}</td><td className="text-right">{p.invoices}</td><td className="text-right">{formatCurrency(p.withoutTax)}</td><td className="text-right">{formatCurrency(p.tax)}</td><td className="text-right">{formatCurrency(p.vat)}</td><td className="text-right">{formatCurrency(p.net)}</td><td className="text-right">{formatCurrency(p.cash)}</td><td className="text-right">{formatCurrency(p.bank)}</td><td className="text-right">{formatCurrency(p.credit)}</td><td className="text-right">{formatCurrency(p.received)}</td><td className="text-right">{formatCurrency(p.outstanding)}</td><td className="text-right">{formatCurrency(p.cogs)}</td><td className="text-right">{formatCurrency(p.gp)}</td><td className="text-right">{p.margin.toFixed(2)}%</td></tr>) : [])])}<tr data-report-total className="report-total-row border-t-2 font-bold"><td>GRAND TOTAL</td><td className="text-right">{salesFiltered.length}</td><td className="text-right">{formatCurrency(sTotals?.withoutTax||0)}</td><td className="text-right">{formatCurrency(sTotals?.tax||0)}</td><td className="text-right">{formatCurrency(sTotals?.vat||0)}</td><td className="text-right">{formatCurrency(sTotals?.net||0)}</td><td className="text-right">{formatCurrency(sTotals?.cash||0)}</td><td className="text-right">{formatCurrency(sTotals?.bank||0)}</td><td className="text-right">{formatCurrency(sTotals?.credit||0)}</td><td className="text-right">{formatCurrency(sTotals?.received||0)}</td><td className="text-right">{formatCurrency(sTotals?.outstanding||0)}</td><td className="text-right">{formatCurrency(sTotals?.cogs||0)}</td><td className="text-right">{formatCurrency(sTotals?.gp||0)}</td><td className="text-right">{(sTotals?.margin||0).toFixed(2)}%</td></tr></tbody></table></div>
    </> : <>
      <div className="grid gap-2 md:grid-cols-4"><div className="summary-card"><div className="summary-label">Gross Purchase</div><div className="summary-value">{formatCurrency(pTotals?.gross || 0)}</div></div><div className="summary-card"><div className="summary-label">Input VAT</div><div className="summary-value">{formatCurrency(pTotals?.vat || 0)}</div></div><div className="summary-card"><div className="summary-label">Paid</div><div className="summary-value">{formatCurrency(pTotals?.paid || 0)}</div></div><div className="summary-card"><div className="summary-label">Outstanding</div><div className="summary-value">{formatCurrency(pTotals?.outstanding || 0)}</div></div></div>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full whitespace-nowrap text-xs"><thead><tr><th>Purchase Person / Supplier</th><th className="text-right">Invoices</th><th className="text-right">Without Tax</th><th className="text-right">With Tax</th><th className="text-right">Input VAT</th><th className="text-right">Item Value</th><th className="text-right">Charges</th><th className="text-right">Gross Purchase</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th></tr></thead><tbody>{purchaseSummary.flatMap(r => [<tr key={r.id} className="font-semibold"><td>{r.name}</td><td className="text-right">{r.invoices}</td><td className="text-right">{formatCurrency(r.withoutTax)}</td><td className="text-right">{formatCurrency(r.tax)}</td><td className="text-right">{formatCurrency(r.vat)}</td><td className="text-right">{formatCurrency(r.itemValue)}</td><td className="text-right">{formatCurrency(r.charges)}</td><td className="text-right">{formatCurrency(r.gross)}</td><td className="text-right">{formatCurrency(r.paid)}</td><td className="text-right">{formatCurrency(r.outstanding)}</td></tr>, ...(showParties ? purchaseParty.filter(p=>p.id===r.id).map(p=><tr key={`${p.id}:${p.party}`} className="text-slate-600"><td className="pl-8">Γå│ {p.party}</td><td className="text-right">{p.invoices}</td><td className="text-right">{formatCurrency(p.withoutTax)}</td><td className="text-right">{formatCurrency(p.tax)}</td><td className="text-right">{formatCurrency(p.vat)}</td><td className="text-right">{formatCurrency(p.itemValue)}</td><td className="text-right">{formatCurrency(p.charges)}</td><td className="text-right">{formatCurrency(p.gross)}</td><td className="text-right">{formatCurrency(p.paid)}</td><td className="text-right">{formatCurrency(p.outstanding)}</td></tr>) : [])])}<tr data-report-total className="report-total-row border-t-2 font-bold"><td>GRAND TOTAL</td><td className="text-right">{purchaseFiltered.length}</td><td className="text-right">{formatCurrency(pTotals?.withoutTax||0)}</td><td className="text-right">{formatCurrency(pTotals?.tax||0)}</td><td className="text-right">{formatCurrency(pTotals?.vat||0)}</td><td className="text-right">{formatCurrency(pTotals?.itemValue||0)}</td><td className="text-right">{formatCurrency(pTotals?.charges||0)}</td><td className="text-right">{formatCurrency(pTotals?.gross||0)}</td><td className="text-right">{formatCurrency(pTotals?.paid||0)}</td><td className="text-right">{formatCurrency(pTotals?.outstanding||0)}</td></tr></tbody></table></div>
    </>}
  </div>;
}
