import SearchableSelect from "@/components/SearchableSelect";
import { fixedTaxRateOn } from "@/lib/effectiveTaxRate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, RefreshCw, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, StatusBadge, formatCurrency, formatDate } from "@/components/ui";
import PrintLayout from "@/components/PrintLayout";
import UnifiedOrderBookInvoicePicker from "@/components/UnifiedOrderBookInvoicePicker";
import { calculateConfiguredChargeAmount, type ConfiguredChargeUnit } from "@/lib/chargeCalculation";

type Supplier = { id: string; name: string; name_urdu?: string | null; phone?: string | null; address?: string | null };
type Item = { id: string; name: string; name_urdu?: string | null; sku?: string | null; cost?: number | string | null; unit?: string | null };
type Godown = { id: string; name: string; name_urdu?: string | null };
type Row = {
  id?: string;
  item_id: string;
  description: string;
  godown_id: string;
  qty: string;
  unit_cost: string;
  tax_percent: string;
  order_book_commitment_id?: string | null;
};
type Charge = {
  charge_key: string; charge_name: string; charge_name_urdu?: string | null; default_rate: number | string;
  unit: ConfiguredChargeUnit; is_fixed: boolean; tax_applicable: boolean; purchase_treatment?: "landed_cost" | "expense" | null;
};
type Invoice = {
  id: string; invoice_no: string; invoice_date: string; supplier_id: string | null;
  reference_name: string | null; reference_no: string | null; reference_notes: string | null;
  invoice_type: "Purchase Invoice" | "Tax Invoice"; tax_percent: number | string;
  subtotal: number | string; item_tax: number | string; charges_total: number | string;
  charge_tax: number | string; total: number | string; status: "draft" | "posted" | "cancelled";
  supplier?: Supplier | null;
};
type CompanyPrintSettings = {
  company_name?: string | null; address?: string | null; phone?: string | null; email?: string | null;
  ntn?: string | null; strn?: string | null; logo_url?: string | null;
  document_header?: string | null; document_header_urdu?: string | null;
  document_footer?: string | null; document_footer_urdu?: string | null;
  prepared_by_label?: string | null; checked_by_label?: string | null; approved_by_label?: string | null;
};
type PrintVisibility = {
  show_company_name: boolean; show_logo: boolean; show_address: boolean; show_phone_email: boolean;
  show_tax_details: boolean; show_header: boolean; show_footer: boolean; show_signatures: boolean;
  show_print_datetime: boolean; show_page_numbers: boolean;
};

const DEFAULT_PRINT_VISIBILITY: PrintVisibility = {
  show_company_name: true, show_logo: true, show_address: true, show_phone_email: true,
  show_tax_details: true, show_header: true, show_footer: true, show_signatures: true,
  show_print_datetime: false, show_page_numbers: true,
};
const makeNo = () => {
  const d = new Date();
  return `CP-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
};
const emptyRow = (tax = "0", godown = ""): Row => ({ item_id: "", description: "", godown_id: godown, qty: "1", unit_cost: "0", tax_percent: tax, order_book_commitment_id: null });
const n = (value: unknown) => Number(value) || 0;
const unitLabel = (unit: ConfiguredChargeUnit) => ({ fixed: "Fixed", percent: "%", per_kg: "per kg", per_ton: "per ton", per_piece: "per piece" }[unit] || unit);

export default function ConsolidatedPurchaseInvoices() {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [configuredCharges, setConfiguredCharges] = useState<Charge[]>([]);
  const [selectedChargeKeys, setSelectedChargeKeys] = useState<string[]>([]);
  const [chargeToAdd, setChargeToAdd] = useState("");
  const [chargeAmounts, setChargeAmounts] = useState<Record<string, string>>({});
  const [companyPrint, setCompanyPrint] = useState<CompanyPrintSettings>({});
  const [printVisibility, setPrintVisibility] = useState<PrintVisibility>(DEFAULT_PRINT_VISIBILITY);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(makeNo());
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState("");
  const [referenceName, setReferenceName] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [referenceNotes, setReferenceNotes] = useState("");
  const [invoiceType, setInvoiceType] = useState<"Purchase Invoice" | "Tax Invoice">("Purchase Invoice");
  const [taxPercent, setTaxPercent] = useState("0");
  const [taxConfigured, setTaxConfigured] = useState(false);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (loading || editingId) return;
    let cancelled=false;
    void fixedTaxRateOn(invoiceDate,"purchase").then(rate=>{
      if(cancelled)return;
      setTaxPercent(rate||"0");setTaxConfigured(rate!==null);
      setRows(rows=>rows.map(row=>({...row,tax_percent:invoiceType==="Tax Invoice"?rate||"0":"0"})));
    }).catch(err=>{if(!cancelled)setError(err instanceof Error?err.message:String(err));});
    return ()=>{cancelled=true;};
  },[invoiceDate,loading,editingId,invoiceType]);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [supplierRes, itemRes, godownRes, invoiceRes, taxRes, companyRes, visibilityRes, chargeRes] = await Promise.all([
      supabase.from("suppliers").select("id,name,name_urdu,phone,address").eq("is_active", true).order("name"),
      supabase.from("items").select("id,name,name_urdu,sku,cost,unit").order("name"),
      supabase.from("godowns").select("id,name,name_urdu").order("name"),
      supabase.from("consolidated_purchase_invoices").select("*,supplier:suppliers(id,name,name_urdu,phone,address)").order("invoice_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("tax_rates").select("rate,is_fixed").eq("is_active", true).eq("is_fixed", true).in("applies_to", ["purchase", "both"]).order("created_at").limit(1).maybeSingle(),
      supabase.from("company_settings").select("*").maybeSingle(),
      supabase.from("document_print_visibility").select("*").eq("document_type", "purchase_invoice").maybeSingle(),
      supabase.from("charge_master").select("charge_key,charge_name,charge_name_urdu,default_rate,unit,is_fixed,tax_applicable,purchase_treatment").eq("is_active", true).in("applies_to", ["purchase", "both"]).order("charge_name"),
    ]);
    setLoading(false);
    const firstError = supplierRes.error || itemRes.error || godownRes.error || invoiceRes.error || taxRes.error || companyRes.error || chargeRes.error;
    if (firstError) { setError(firstError.message); return; }
    const loadedGodowns = (godownRes.data ?? []) as Godown[];
    setSuppliers((supplierRes.data ?? []) as Supplier[]); setItems((itemRes.data ?? []) as Item[]); setGodowns(loadedGodowns);
    setInvoices((invoiceRes.data ?? []) as unknown as Invoice[]); setConfiguredCharges((chargeRes.data ?? []) as Charge[]);
    setCompanyPrint((companyRes.data || {}) as CompanyPrintSettings);
    if (!visibilityRes.error) setPrintVisibility({ ...DEFAULT_PRINT_VISIBILITY, ...(visibilityRes.data || {}) });
    if (taxRes.data) {
      const rate = String(n(taxRes.data.rate)); setTaxPercent(rate); setTaxConfigured(true);
      if (!editingId) setRows((current) => current.map((row) => ({ ...row, tax_percent: rate, godown_id: row.godown_id || loadedGodowns[0]?.id || "" })));
    } else {
      setTaxConfigured(false);
    }
  }, [editingId]);

  useEffect(() => { void load(); }, [load]);

  const reset = () => {
    setEditingId(null); setInvoiceNo(makeNo()); setInvoiceDate(new Date().toISOString().slice(0, 10)); setSupplierId("");
    setReferenceName(""); setReferenceNo(""); setReferenceNotes(""); setInvoiceType("Purchase Invoice");
    setRows([emptyRow(taxPercent, godowns[0]?.id ?? "")]); setSelectedChargeKeys([]); setChargeAmounts({}); setChargeToAdd(""); setShowForm(false);
  };

  const subtotal = rows.reduce((sum, row) => sum + n(row.qty) * n(row.unit_cost), 0);
  const itemTax = invoiceType === "Tax Invoice" ? rows.reduce((sum, row) => sum + n(row.qty) * n(row.unit_cost) * n(row.tax_percent) / 100, 0) : 0;
  const selectedCharges = useMemo(() => configuredCharges.filter((charge) => selectedChargeKeys.includes(charge.charge_key)), [configuredCharges, selectedChargeKeys]);
  const availableCharges = useMemo(() => configuredCharges.filter((charge) => !selectedChargeKeys.includes(charge.charge_key)), [configuredCharges, selectedChargeKeys]);
  const chargesTotal = selectedCharges.reduce((sum, charge) => sum + n(chargeAmounts[charge.charge_key]), 0);
  const chargeTax = invoiceType === "Tax Invoice" ? selectedCharges.reduce((sum, charge) => charge.tax_applicable ? sum + n(chargeAmounts[charge.charge_key]) * n(taxPercent) / 100 : sum, 0) : 0;
  const total = subtotal + itemTax + chargesTotal + chargeTax;
  const currentInvoice = useMemo(() => invoices.find((invoice) => invoice.id === editingId) ?? null, [invoices, editingId]);
  const locked = currentInvoice?.status === "posted";
  const currentSupplier = suppliers.find((supplier) => supplier.id === supplierId) ?? currentInvoice?.supplier ?? null;
  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((invoice) => [invoice.invoice_no, invoice.supplier?.name, invoice.invoice_date, invoice.invoice_type, invoice.status, invoice.reference_name, invoice.reference_no]
      .some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [invoices, search]);

  useEffect(() => {
    if (!selectedChargeKeys.length) return;
    setChargeAmounts((current) => {
      const next = { ...current };
      selectedChargeKeys.forEach((key) => {
        const charge = configuredCharges.find((candidate) => candidate.charge_key === key); if (!charge || !charge.is_fixed) return;
        next[key] = String(calculateConfiguredChargeAmount({ unit: charge.unit, rate: n(charge.default_rate), rows, items, baseAmount: subtotal }));
      });
      return next;
    });
  }, [selectedChargeKeys, configuredCharges, rows, items, subtotal]);

  const handleInvoiceType = (value: "Purchase Invoice" | "Tax Invoice") => {
    if (locked) return;
    setInvoiceType(value);
    setRows((current) => current.map((row) => ({ ...row, tax_percent: value === "Tax Invoice" ? taxPercent : "0" })));
  };

  const updateRow = (index: number, field: keyof Row, value: string) => {
    if (locked) return;
    setRows((current) => current.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, [field]: value };
      if (field === "item_id") { const item = items.find((candidate) => candidate.id === value); if (item) next.unit_cost = String(n(item.cost)); }
      return next;
    }));
  };

  const addLine = () => {
    if (locked) return;
    setRows((current) => [...current, emptyRow(invoiceType === "Tax Invoice" ? taxPercent : "0", godowns[0]?.id ?? "")]);
  };

  const removeLine = (index: number) => {
    if (locked) return;
    setRows((current) => {
      if (current.length <= 1) return [emptyRow(invoiceType === "Tax Invoice" ? taxPercent : "0", godowns[0]?.id ?? "")];
      return current.filter((_, i) => i !== index);
    });
  };

  const addCharge = () => {
    if (!chargeToAdd || locked) return;
    const charge = configuredCharges.find((candidate) => candidate.charge_key === chargeToAdd); if (!charge) return;
    const amount = calculateConfiguredChargeAmount({ unit: charge.unit, rate: n(charge.default_rate), rows, items, baseAmount: subtotal });
    setSelectedChargeKeys((current) => current.includes(charge.charge_key) ? current : [...current, charge.charge_key]);
    setChargeAmounts((current) => ({ ...current, [charge.charge_key]: String(amount) })); setChargeToAdd("");
  };

  const editInvoice = async (invoice: Invoice) => {
    setError(null); setSuccess(null);
    const [lineRes, chargeRes] = await Promise.all([
      supabase.from("consolidated_purchase_invoice_lines").select("*").eq("invoice_id", invoice.id).order("created_at"),
      supabase.from("consolidated_purchase_invoice_charges").select("charge_key,amount").eq("invoice_id", invoice.id).order("created_at"),
    ]);
    if (lineRes.error || chargeRes.error) { setError(lineRes.error?.message || chargeRes.error?.message || "Failed to open invoice."); return; }
    setEditingId(invoice.id); setInvoiceNo(invoice.invoice_no); setInvoiceDate(invoice.invoice_date); setSupplierId(invoice.supplier_id ?? "");
    setReferenceName(invoice.reference_name ?? ""); setReferenceNo(invoice.reference_no ?? ""); setReferenceNotes(invoice.reference_notes ?? "");
    setInvoiceType(invoice.invoice_type); setTaxPercent(String(invoice.tax_percent ?? taxPercent));
    setRows((lineRes.data ?? []).length ? (lineRes.data ?? []).map((line: any) => ({
      id: line.id,
      item_id: line.item_id,
      description: line.description ?? "",
      godown_id: line.godown_id,
      qty: String(line.qty),
      unit_cost: String(line.unit_cost),
      tax_percent: String(line.tax_percent),
      order_book_commitment_id: line.order_book_commitment_id ?? null,
    })) : [emptyRow(taxPercent, godowns[0]?.id ?? "")]);
    const chargeRows = chargeRes.data ?? [];
    setSelectedChargeKeys(chargeRows.map((row: any) => row.charge_key));
    setChargeAmounts(Object.fromEntries(chargeRows.map((row: any) => [row.charge_key, String(row.amount)])));
    setShowForm(true);
    requestAnimationFrame(() => requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })));
  };

  const deleteDraft = async (invoiceId: string, invoiceLabel: string) => {
    if (!window.confirm(`Delete draft ${invoiceLabel}? This cannot be undone.`)) return;
    setDeleting(true); setError(null); setSuccess(null);
    const { error: deleteError } = await supabase.rpc("delete_consolidated_purchase_draft", { p_invoice_id: invoiceId });
    setDeleting(false);
    if (deleteError) { setError(deleteError.message); return; }
    if (editingId === invoiceId) reset();
    setSuccess(`${invoiceLabel} draft deleted.`);
    await load();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (locked) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      if (!supplierId) throw new Error("Please select a supplier.");
      if (invoiceType === "Tax Invoice" && !taxConfigured) throw new Error("Add and fix an active Purchase/Both tax rate in Tax Settings first.");
      const validRows = rows.filter((row) => row.item_id && n(row.qty) > 0);
      if (!validRows.length) throw new Error("Add at least one item.");
      if (validRows.some((row) => !row.godown_id)) throw new Error("Select a godown for every item.");
      const payload = {
        invoice_no: invoiceNo, invoice_date: invoiceDate, supplier_id: supplierId,
        reference_name: referenceName.trim() || null, reference_no: referenceNo.trim() || null, reference_notes: referenceNotes.trim() || null,
        invoice_type: invoiceType, tax_percent: invoiceType === "Tax Invoice" ? n(taxPercent) : 0,
        subtotal, item_tax: itemTax, charges_total: chargesTotal, charge_tax: chargeTax, total,
      };
      let invoiceId = editingId;
      if (editingId) {
        const { error: updateError } = await supabase.from("consolidated_purchase_invoices").update(payload).eq("id", editingId); if (updateError) throw updateError;
        const { error: deleteError } = await supabase.from("consolidated_purchase_invoice_lines").delete().eq("invoice_id", editingId); if (deleteError) throw deleteError;
      } else {
        const { data, error: insertError } = await supabase.from("consolidated_purchase_invoices").insert({ ...payload, status: "draft" }).select().single();
        if (insertError) throw insertError; invoiceId = data.id;
      }
      if (!invoiceId) throw new Error("Invoice id missing.");
      const { error: lineError } = await supabase.from("consolidated_purchase_invoice_lines").insert(validRows.map((row) => ({
        invoice_id: invoiceId,
        item_id: row.item_id,
        godown_id: row.godown_id,
        qty: n(row.qty),
        unit_cost: n(row.unit_cost),
        tax_percent: invoiceType === "Tax Invoice" ? n(row.tax_percent) : 0,
        description: row.description.trim() || null,
        line_total: n(row.qty) * n(row.unit_cost),
        order_book_commitment_id: row.order_book_commitment_id ?? null,
      })));
      if (lineError) throw lineError;
      const chargePayload = selectedCharges.map((charge) => ({
        charge_key: charge.charge_key,
        amount: n(chargeAmounts[charge.charge_key]),
        tax_percent: invoiceType === "Tax Invoice" && charge.tax_applicable ? n(taxPercent) : 0,
      })).filter((row) => row.amount > 0);
      const { error: chargeError } = await supabase.rpc("replace_consolidated_purchase_invoice_charges", { p_invoice_id: invoiceId, p_charges: chargePayload });
      if (chargeError) throw chargeError;
      setSuccess("Consolidated Purchase Invoice saved. Post it when goods are physically received.");
      reset(); await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save Consolidated Purchase Invoice.");
    } finally {
      setSaving(false);
    }
  };

  const post = async (invoice: Invoice) => {
    setPostingId(invoice.id); setError(null); setSuccess(null);
    const { error: postError } = await supabase.rpc("post_consolidated_purchase_invoice", { p_invoice_id: invoice.id });
    setPostingId(null);
    if (postError) { setError(postError.message); return; }
    setSuccess(`${invoice.invoice_no} posted: stock received. Supplier accounting will be created only when it is added to a Main Purchase Invoice and that Main Invoice is posted.`);
    await load();
  };

  const printCharges = selectedCharges.map((charge) => ({ label: charge.charge_name, amount: n(chargeAmounts[charge.charge_key]) }));

  return <div>
    <div className="print:hidden space-y-3">
      <section className="flex flex-col gap-3 border-b border-slate-200 pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link to="/purchase" className="mb-1 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-blue-700"><ArrowLeft className="h-3 w-3" />Purchase</Link>
          <h1 className="text-xl font-bold text-slate-900">Consolidated Purchase</h1>
          <p className="text-[12px] text-slate-500">Separate receiving documents. Stock posts here; supplier accounting posts only through the linked Main Purchase Invoice.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span data-navilo-standard-tools-host className="contents" />
          <button type="button" className="btn-secondary" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          <button type="button" className="btn-primary" onClick={() => { reset(); setShowForm(true); requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }}><Plus className="h-3.5 w-3.5" />New Consolidated Purchase</button>
        </div>
      </section>
      {error && <ErrorBanner message={error} />}
      {success && <div className="rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">{success}</div>}

      {!showForm && <div className="relative max-w-md" data-no-export data-no-print>
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <input className="input pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search document, supplier or reference…" />
      </div>}

      {showForm && <form ref={formRef} onSubmit={save} className="navilo-consolidated-purchase-editor mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{editingId ? "Open" : "New"} Consolidated Purchase Invoice</h3>
          <div className="flex flex-wrap gap-2">
            {editingId && <button type="button" className="btn-secondary" data-print-selector="#consolidated-purchase-print-root">Print / PDF</button>}
            {!locked && <button type="button" className="btn-secondary" onClick={addLine}>+ Add Line</button>}
            {editingId && currentInvoice?.status === "draft" && <button type="button" className="btn-danger" disabled={deleting} onClick={() => void deleteDraft(editingId, invoiceNo)}>{deleting ? "Deleting..." : "Delete Draft"}</button>}
            <button type="button" className="btn-secondary" onClick={reset}>Close</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div><label className="label">Invoice No.</label><input className="input cursor-not-allowed bg-slate-50" value={invoiceNo} readOnly tabIndex={-1} /></div>
          <div><label className="label">Supplier</label><SearchableSelect className="input" value={supplierId} disabled={locked} onChange={(e) => setSupplierId(e.target.value)}><option value="">— Select —</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.name_urdu ? ` / ${supplier.name_urdu}` : ""}</option>)}</SearchableSelect></div>
          <div><label className="label">Date</label><input className="input" type="date" value={invoiceDate} disabled={locked} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          <div><label className="label">Type</label><SearchableSelect className="input" value={invoiceType} disabled={locked} onChange={(e) => handleInvoiceType(e.target.value as "Purchase Invoice" | "Tax Invoice")}><option value="Purchase Invoice">Without Tax</option><option value="Tax Invoice">With Tax</option></SearchableSelect></div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div><label className="label">Reference Name</label><input className="input" value={referenceName} disabled={locked} onChange={(e) => setReferenceName(e.target.value)} /></div>
          <div><label className="label">Reference No.</label><input className="input" value={referenceNo} disabled={locked} onChange={(e) => setReferenceNo(e.target.value)} /></div>
          <div><label className="label">Notes</label><input className="input" value={referenceNotes} disabled={locked} onChange={(e) => setReferenceNotes(e.target.value)} /></div>
        </div>
        {invoiceType === "Tax Invoice" && <div className="max-w-xs"><label className="label">Configured VAT %</label><input className="input cursor-not-allowed bg-slate-50" disabled value={taxPercent} /></div>}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[1220px] table-fixed text-sm">
            <thead className="bg-slate-50"><tr className="border-b border-slate-200"><th className="p-2 text-left">Item</th><th className="p-2 text-left">Description</th><th className="p-2 text-left">Godown</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit Cost</th>{invoiceType === "Tax Invoice" && <><th className="p-2 text-right">VAT %</th><th className="p-2 text-right">VAT Amount</th></>}<th className="p-2 text-right">Amount</th><th className="p-2 text-center">Action</th></tr></thead>
            <tbody>{rows.map((row, index) => {
              const base = n(row.qty) * n(row.unit_cost);
              const tax = invoiceType === "Tax Invoice" ? base * n(row.tax_percent) / 100 : 0;
              return <tr key={`${row.id || "new"}-${index}`} className="border-b border-slate-100 align-top">
                <td className="p-2"><SearchableSelect className="input w-full" disabled={locked} value={row.item_id} onChange={(e) => updateRow(index, "item_id", e.target.value)}><option value="">— Select —</option>{items.map((item) => <option key={item.id} value={item.id} data-search={item.sku||undefined}>{item.name}</option>)}</SearchableSelect>{row.order_book_commitment_id && <div className="mt-1 text-[11px] font-medium text-primary-600">Order Book linked</div>}</td>
                <td className="p-2"><input className="input w-full" disabled={locked} value={row.description} placeholder="Optional description" onChange={(e) => updateRow(index, "description", e.target.value)} /></td>
                <td className="p-2"><SearchableSelect className="input w-full" disabled={locked} value={row.godown_id} onChange={(e) => updateRow(index, "godown_id", e.target.value)}><option value="">— Select —</option>{godowns.map((godown) => <option key={godown.id} value={godown.id}>{godown.name}{godown.name_urdu ? ` / ${godown.name_urdu}` : ""}</option>)}</SearchableSelect></td>
                <td className="p-2"><input className="input w-full text-right" type="number" min="0.001" step="0.001" disabled={locked} value={row.qty} onChange={(e) => updateRow(index, "qty", e.target.value)} /></td>
                <td className="p-2"><input className="input w-full text-right" type="number" min="0" step="0.01" disabled={locked || Boolean(row.order_book_commitment_id)} value={row.unit_cost} onChange={(e) => updateRow(index, "unit_cost", e.target.value)} /></td>
                {invoiceType === "Tax Invoice" && <><td className="p-2 text-right font-medium">{n(row.tax_percent)}%</td><td className="p-2 text-right whitespace-nowrap">{formatCurrency(tax)}</td></>}
                <td className="p-2 text-right font-semibold whitespace-nowrap">{formatCurrency(base + tax)}</td>
                <td className="p-2 text-center">{!locked && <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-rose-600 hover:bg-rose-50" onClick={() => removeLine(index)} aria-label="Remove line" title="Remove line">×</button>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>

        {!locked && <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={addLine}>+ Add Line</button></div>}

        <div className="rounded-lg border border-slate-200 p-4">
          <div className="mb-3"><h4 className="font-semibold text-slate-900">Applicable Charges</h4><p className="text-xs text-slate-500">Rates and calculation basis come from Charge Master. Taxable charges use the configured fixed VAT rate.</p></div>
          {!locked && <div className="mb-3 flex flex-wrap gap-2"><SearchableSelect className="input max-w-sm" value={chargeToAdd} onChange={(e) => setChargeToAdd(e.target.value)}><option value="">— Select charge to add —</option>{availableCharges.map((charge) => <option key={charge.charge_key} value={charge.charge_key}>{charge.charge_name}{charge.charge_name_urdu ? ` / ${charge.charge_name_urdu}` : ""} · {n(charge.default_rate)} {unitLabel(charge.unit)}</option>)}</SearchableSelect><button type="button" className="btn-secondary" disabled={!chargeToAdd} onClick={addCharge}>+ Add Charge</button></div>}
          {selectedCharges.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-400">No purchase charges added.</div> : <div className="space-y-2">{selectedCharges.map((charge) => <div key={charge.charge_key} className="grid grid-cols-1 items-center gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_150px_120px_120px_auto]"><div><div className="font-medium">{charge.charge_name}{charge.charge_name_urdu ? ` / ${charge.charge_name_urdu}` : ""}</div><div className="text-xs text-slate-500">{n(charge.default_rate)} {unitLabel(charge.unit)} · {charge.purchase_treatment === "expense" ? "Expense" : "Landed Cost / Inventory"}</div></div><input className="input text-right" type="number" min="0" step="0.01" disabled={locked || charge.is_fixed} value={chargeAmounts[charge.charge_key] ?? "0"} onChange={(e) => setChargeAmounts((current) => ({ ...current, [charge.charge_key]: e.target.value }))} /><div className="text-right text-sm">{charge.tax_applicable && invoiceType === "Tax Invoice" ? `${n(taxPercent)}% VAT` : "No VAT"}</div><div className="text-right font-semibold">{formatCurrency(n(chargeAmounts[charge.charge_key]))}</div>{!locked && <button type="button" className="text-sm font-semibold text-error-600" onClick={() => { setSelectedChargeKeys((current) => current.filter((key) => key !== charge.charge_key)); setChargeAmounts((current) => ({ ...current, [charge.charge_key]: "0" })); }}>Remove</button>}</div>)}</div>}
        </div>

        <div className="flex justify-end"><div className="w-full max-w-md rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex justify-between py-1.5"><span>Direct Items</span><span className="font-semibold">{formatCurrency(subtotal)}</span></div><div className="flex justify-between py-1.5"><span>Charges</span><span className="font-semibold">{formatCurrency(chargesTotal)}</span></div>{invoiceType === "Tax Invoice" && <><div className="flex justify-between py-1.5"><span>Items VAT</span><span className="font-semibold">{formatCurrency(itemTax)}</span></div><div className="flex justify-between py-1.5"><span>Charge VAT</span><span className="font-semibold">{formatCurrency(chargeTax)}</span></div></>}<div className="mt-2 flex justify-between border-t border-slate-300 pt-3 text-lg font-bold"><span>Grand Total</span><span>{formatCurrency(total)}</span></div></div></div>
        {!locked && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">{editingId && currentInvoice?.status === "draft" && <button type="button" className="btn-danger" disabled={deleting} onClick={() => void deleteDraft(editingId, invoiceNo)}>{deleting ? "Deleting..." : "Delete Draft"}</button>}<button className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Consolidated Purchase"}</button></div>}
      </form>}

      {!showForm && <div data-report-content className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-slate-50"><th className="p-3 text-left">Invoice</th><th className="p-3 text-left">Supplier</th><th className="p-3 text-left">Date</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">VAT</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="p-8 text-center text-slate-400">Loading…</td></tr> : filteredInvoices.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-slate-400">No Consolidated Purchase Invoices found.</td></tr> : filteredInvoices.map((invoice) => <tr key={invoice.id} className="border-b border-slate-100"><td className="p-3 font-medium">{invoice.invoice_no}</td><td className="p-3">{invoice.supplier?.name ?? "—"}</td><td className="p-3">{formatDate(invoice.invoice_date)}</td><td className="p-3">{invoice.invoice_type === "Tax Invoice" ? "With Tax" : "Without Tax"}</td><td className="p-3"><StatusBadge status={invoice.status} /></td><td className="p-3 text-right">{invoice.invoice_type === "Tax Invoice" ? formatCurrency(n(invoice.item_tax) + n(invoice.charge_tax)) : "—"}</td><td className="p-3 text-right font-semibold">{formatCurrency(n(invoice.total))}</td><td className="p-3 text-right"><div className="flex justify-end gap-2"><button type="button" className="btn-secondary text-xs" onClick={() => void editInvoice(invoice)}>{editingId === invoice.id && showForm ? "Editing" : "Open / Edit"}</button>{invoice.status === "draft" && <button type="button" className="btn-danger text-xs" disabled={deleting} onClick={() => void deleteDraft(invoice.id, invoice.invoice_no)}>Delete</button>}{invoice.status === "draft" && <button type="button" className="btn-primary text-xs" disabled={postingId === invoice.id} onClick={() => void post(invoice)}>{postingId === invoice.id ? "Posting..." : "Post / Receive Stock"}</button>}</div></td></tr>)}</tbody></table></div>}
    </div>

    {showForm && editingId && <div id="consolidated-purchase-print-root" className="hidden print:block" data-print-root><PrintLayout
      voucherTitle={invoiceType === "Tax Invoice" ? "Purchase Tax Invoice" : "Purchase Invoice"}
      voucherNo={invoiceNo} voucherDate={invoiceDate}
      company={{ name: companyPrint.company_name || undefined, address: companyPrint.address || undefined, phone: companyPrint.phone || undefined, email: companyPrint.email || undefined, taxId: [companyPrint.ntn, companyPrint.strn].filter(Boolean).join(" / ") || undefined, logoUrl: companyPrint.logo_url || undefined }}
      party={{ name: currentSupplier?.name || "—", address: currentSupplier?.address, phone: currentSupplier?.phone }}
      items={rows.filter((row) => row.item_id).map((row) => { const item = items.find((candidate) => candidate.id === row.item_id); const base = n(row.qty) * n(row.unit_cost); const tax = invoiceType === "Tax Invoice" ? base * n(row.tax_percent) / 100 : 0; const godown = godowns.find((g) => g.id === row.godown_id)?.name; return { name: item?.name || "—", description: [row.description, godown ? `Godown: ${godown}` : ""].filter(Boolean).join(" · ") || "Consolidated Purchase", qty: n(row.qty), unitPrice: n(row.unit_cost), lineTotal: base + tax, taxPercent: invoiceType === "Tax Invoice" ? n(row.tax_percent) : 0, taxAmount: tax }; })}
      chargeBreakdown={printCharges} itemsTotal={subtotal} chargesTotal={chargesTotal} taxAmount={itemTax + chargeTax} showTaxSummary={invoiceType === "Tax Invoice"} grandTotal={total}
      extraFields={[{ label: "Document", value: "Consolidated Purchase" }, { label: "Status", value: currentInvoice?.status?.toUpperCase() || "DRAFT" }, ...(referenceName ? [{ label: "Reference Name", value: referenceName }] : []), ...(referenceNo ? [{ label: "Reference No", value: referenceNo }] : []), ...(invoiceType === "Tax Invoice" ? [{ label: "VAT Rate", value: `${n(taxPercent)}% (Fixed)` }] : [])]}
      documentNotice="Separate receiving document. Accounting is created only after linking to and posting the Main Purchase Invoice."
      documentNoticeUrdu="یہ الگ وصولی دستاویز ہے۔ اکاؤنٹنگ صرف مین پرچیز انوائس سے لنک اور پوسٹ ہونے کے بعد بنے گی۔"
      signatureLabels={[companyPrint.prepared_by_label || "Prepared By", companyPrint.checked_by_label || "Checked By", companyPrint.approved_by_label || "Approved By"]}
      visibility={{ showCompanyName: printVisibility.show_company_name, showLogo: printVisibility.show_logo, showAddress: printVisibility.show_address, showPhoneEmail: printVisibility.show_phone_email, showTaxDetails: printVisibility.show_tax_details, showHeader: printVisibility.show_header, showFooter: printVisibility.show_footer, showSignatures: printVisibility.show_signatures, showPrintDatetime: printVisibility.show_print_datetime, showPageNumbers: printVisibility.show_page_numbers }}
      documentHeader={companyPrint.document_header} documentHeaderUrdu={companyPrint.document_header_urdu} documentFooter={companyPrint.document_footer} documentFooterUrdu={companyPrint.document_footer_urdu}
    /></div>}
  </div>;
}
