import SearchableSelect from "@/components/SearchableSelect";
import { fixedTaxRateOn } from "@/lib/effectiveTaxRate";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, FileCheck2, Plus, Printer, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import PrintLayout from "@/components/PrintLayout";
import UnifiedOrderBookInvoicePicker from "@/components/UnifiedOrderBookInvoicePicker";
import { calculateConfiguredChargeAmount, chargeQuantityForUnit } from "@/lib/chargeCalculation";
import { triggerPrint } from "@/lib/exportUtils";
import { supabase } from "@/lib/supabase";

type InvoiceType = "Sale Invoice" | "Tax Invoice";
type Customer = { id: string; name: string; name_urdu?: string | null; address?: string | null; phone?: string | null; email?: string | null; ntn?: string | null; strn?: string | null };
type Item = { id: string; name: string; sku?: string | null; name_urdu?: string | null; grade?: string | null; size?: string | null; unit?: string | null; weight_per_piece?: number | string | null };
type Godown = { id: string; name: string; name_urdu?: string | null };
type ChargeMaster = { id: string; charge_key: string; charge_name: string; default_rate: number | string; unit: "fixed" | "percent" | "per_kg" | "per_ton" | "per_piece"; tax_applicable: boolean; is_fixed: boolean };
type CompanyPrintSettings = { company_name?: string | null; address?: string | null; phone?: string | null; email?: string | null; ntn?: string | null; strn?: string | null; logo_url?: string | null; document_header?: string | null; document_header_urdu?: string | null; document_footer?: string | null; document_footer_urdu?: string | null; prepared_by_label?: string | null; checked_by_label?: string | null; approved_by_label?: string | null };
type HawalaInvoice = { id: string; invoice_no: string; invoice_date: string; customer_id: string | null; reference_name: string | null; reference_no: string | null; reference_notes: string | null; invoice_type: string; tax_percent: number | string; item_tax: number | string; charges_total: number | string; charge_tax: number | string; subtotal: number | string; total: number | string; status: "draft" | "posted" | "cancelled"; main_sales_order_id: string | null; posted_at: string | null; customer?: Customer | null };
type InvoiceRow = { id?: string; item_id: string; godown_id: string; qty: string; rate: string; tax_percent: string; description: string };
type ChargeRow = { charge_key: string; quantity: string; rate: string; amount: string; tax_percent: string };

const money = (value: unknown) => `Rs ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const generateHawalaNo = () => {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  return `CI-${stamp}`;
};
const emptyRow = (tax = "0", godownId = ""): InvoiceRow => ({ item_id: "", godown_id: godownId, qty: "0", rate: "0", tax_percent: tax, description: "" });

export default function ConsolidatedInvoices() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [chargeMaster, setChargeMaster] = useState<ChargeMaster[]>([]);
  const [invoices, setInvoices] = useState<HawalaInvoice[]>([]);
  const [companyPrint, setCompanyPrint] = useState<CompanyPrintSettings>({});
  const [configuredTaxRate, setConfiguredTaxRate] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(generateHawalaNo());
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [customerId, setCustomerId] = useState("");
  const [referenceName, setReferenceName] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [referenceNotes, setReferenceNotes] = useState("");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("Sale Invoice");
  const [rows, setRows] = useState<InvoiceRow[]>([emptyRow()]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [chargeToAdd, setChargeToAdd] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || Boolean(editingId)) return;
    let cancelled = false;
    void fixedTaxRateOn(invoiceDate, "sales").then(rate => {
      if (cancelled) return;
      setConfiguredTaxRate(rate); setRows(rows=>rows.map(row=>({...row,tax_percent: invoiceType === "Tax Invoice" ? rate || "0" : "0"}))); setCharges(charges=>charges.map(charge=>({...charge,tax_percent:invoiceType==="Tax Invoice"&&chargeMaster.find(master=>master.charge_key===charge.charge_key)?.tax_applicable?rate||"0":"0"})));
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [invoiceDate, loading, editingId, invoiceType,chargeMaster]);
  const [success, setSuccess] = useState("");

  const editingInvoice = useMemo(() => invoices.find((row) => row.id === editingId) || null, [invoices, editingId]);
  const isLocked = editingInvoice?.status === "posted";
  const globalTaxPercent = invoiceType === "Tax Invoice" ? configuredTaxRate || "0" : "0";

  const loadBaseData = useCallback(async () => {
    const [customersRes, itemsRes, godownsRes, chargesRes, taxRes, companyRes] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("items").select("*").order("name"),
      supabase.from("godowns").select("id,name,name_urdu").order("name"),
      supabase.from("charge_master").select("id,charge_key,charge_name,default_rate,unit,tax_applicable,is_fixed").eq("is_active", true).in("applies_to", ["sales", "both"]).order("charge_name"),
      supabase.from("tax_rates").select("rate").eq("is_active", true).eq("is_fixed", true).in("applies_to", ["sales", "both"]).order("created_at").limit(1).maybeSingle(),
      supabase.from("company_settings").select("*").maybeSingle(),
    ]);
    const firstError = [customersRes.error, itemsRes.error, godownsRes.error, chargesRes.error, taxRes.error, companyRes.error].find(Boolean);
    if (firstError) throw firstError;
    setCustomers((customersRes.data ?? []) as Customer[]);
    setItems((itemsRes.data ?? []) as Item[]);
    setGodowns((godownsRes.data ?? []) as Godown[]);
    setChargeMaster((chargesRes.data ?? []) as ChargeMaster[]);
    setConfiguredTaxRate(taxRes.data ? String(Number(taxRes.data.rate) || 0) : null);
    setCompanyPrint((companyRes.data || {}) as CompanyPrintSettings);
  }, []);

  const loadInvoices = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("consolidated_sales_invoices").select("id,invoice_no,invoice_date,customer_id,reference_name,reference_no,reference_notes,invoice_type,tax_percent,item_tax,charges_total,charge_tax,subtotal,total,status,main_sales_order_id,posted_at,customer:customers(id,name,name_urdu)").order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    if (loadError) throw loadError;
    setInvoices((data ?? []) as unknown as HawalaInvoice[]);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await Promise.all([loadBaseData(), loadInvoices()]);
      } catch (e: any) {
        setError(e?.message || "Failed to load Consolidated Sales Invoice invoices.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadBaseData, loadInvoices]);

  const resetForm = () => {
    setEditingId(null);
    setInvoiceNo(generateHawalaNo());
    setInvoiceDate(today());
    setCustomerId("");
    setReferenceName("");
    setReferenceNo("");
    setReferenceNotes("");
    setInvoiceType("Sale Invoice");
    setRows([emptyRow("0", godowns[0]?.id || "")]);
    setCharges([]);
    setChargeToAdd("");
    setError("");
    setSuccess("");
  };

  const openInvoice = async (invoice: HawalaInvoice) => {
    setError("");
    setSuccess("");
    setEditingId(invoice.id);
    setInvoiceNo(invoice.invoice_no);
    setInvoiceDate(invoice.invoice_date);
    setCustomerId(invoice.customer_id || "");
    setReferenceName(invoice.reference_name || "");
    setReferenceNo(invoice.reference_no || "");
    setReferenceNotes(invoice.reference_notes || "");
    const canonicalType: InvoiceType = invoice.invoice_type === "Tax Invoice" ? "Tax Invoice" : "Sale Invoice";
    setInvoiceType(canonicalType);

    const [linesRes, chargesRes] = await Promise.all([
      supabase.from("consolidated_sales_invoice_lines").select("id,item_id,godown_id,qty,unit_price,tax_percent,description").eq("invoice_id", invoice.id).order("created_at"),
      supabase.from("consolidated_sales_invoice_charges").select("charge_key,quantity,rate,amount,tax_percent").eq("invoice_id", invoice.id).order("created_at"),
    ]);
    if (linesRes.error) return setError(linesRes.error.message);
    if (chargesRes.error) return setError(chargesRes.error.message);

    setRows((linesRes.data ?? []).length ? (linesRes.data ?? []).map((row: any) => ({ id: row.id, item_id: row.item_id || "", godown_id: row.godown_id || "", qty: String(row.qty ?? 0), rate: String(row.unit_price ?? 0), tax_percent: String(row.tax_percent ?? 0), description: row.description || "" })) : [emptyRow(canonicalType === "Tax Invoice" ? configuredTaxRate || "0" : "0", godowns[0]?.id || "")]);
    setCharges((chargesRes.data ?? []).map((row: any) => ({ charge_key: row.charge_key, quantity: String(row.quantity ?? 1), rate: String(row.rate ?? row.amount ?? 0), amount: String(row.amount ?? 0), tax_percent: String(row.tax_percent ?? 0) })));
    setShowForm(true);
  };

  const rowsSubtotal = rows.reduce((sum, row) => sum + (Number(row.qty) || 0) * (Number(row.rate) || 0), 0);
  const itemTax = invoiceType === "Tax Invoice" ? rows.reduce((sum, row) => { const base = (Number(row.qty) || 0) * (Number(row.rate) || 0); return sum + (base * (Number(row.tax_percent) || 0)) / 100; }, 0) : 0;
  const chargesSubtotal = charges.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const chargeTax = invoiceType === "Tax Invoice" ? charges.reduce((sum, row) => sum + ((Number(row.amount) || 0) * (Number(row.tax_percent) || 0)) / 100, 0) : 0;
  const grandTotal = rowsSubtotal + itemTax + chargesSubtotal + chargeTax;

  const recalculateCharge = (charge: ChargeRow, nextRate?: string) => {
    const master = chargeMaster.find((row) => row.charge_key === charge.charge_key);
    if (!master) return charge;
    const rate = Number(nextRate ?? charge.rate ?? master.default_rate) || 0;
    const quantity = chargeQuantityForUnit(master.unit, rows as any, items as any, rowsSubtotal);
    const amount = calculateConfiguredChargeAmount({ unit: master.unit, rate, rows: rows as any, items: items as any, baseAmount: rowsSubtotal });
    return { ...charge, quantity: String(Number(quantity.toFixed(3))), rate: String(rate), amount: String(Number(amount.toFixed(2))) };
  };

  useEffect(() => {
    if (isLocked || !charges.length) return;
    setCharges((current) => current.map((charge) => recalculateCharge(charge)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rowsSubtotal, items]);

  const updateRow = (index: number, field: keyof InvoiceRow, value: string) => {
    if (isLocked) return;
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  };

  const changeInvoiceType = (next: InvoiceType) => {
    if (isLocked) return;
    setInvoiceType(next);
    const nextTax = next === "Tax Invoice" ? configuredTaxRate || "0" : "0";
    setRows((current) => current.map((row) => ({ ...row, tax_percent: nextTax })));
    setCharges((current) => current.map((charge) => ({ ...charge, tax_percent: next === "Tax Invoice" && chargeMaster.find((master) => master.charge_key === charge.charge_key)?.tax_applicable ? nextTax : "0" })));
  };

  const addCharge = () => {
    if (!chargeToAdd || isLocked || charges.some((row) => row.charge_key === chargeToAdd)) return;
    const master = chargeMaster.find((row) => row.charge_key === chargeToAdd);
    if (!master) return;
    const base: ChargeRow = { charge_key: master.charge_key, quantity: "1", rate: String(Number(master.default_rate) || 0), amount: "0", tax_percent: invoiceType === "Tax Invoice" && master.tax_applicable ? configuredTaxRate || "0" : "0" };
    setCharges((current) => [...current, recalculateCharge(base)]);
    setChargeToAdd("");
  };

  const saveDraft = async () => {
    if (isLocked) return setError("Posted Consolidated Sales Invoice document is immutable.");
    if (!customerId) return setError("Select customer.");
    if (!referenceName.trim()) return setError("Enter Hawala / Reference Name.");
    if (invoiceType === "Tax Invoice" && !configuredTaxRate) return setError("Configure one active fixed Sales/Both tax rate before using With Tax.");
    const validRows = rows.filter((row) => row.item_id && Number(row.qty) > 0);
    if (!validRows.length) return setError("Add at least one item with quantity.");
    if (validRows.some((row) => !row.godown_id)) return setError("Select godown for every item.");

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      let invoiceId = editingId;
      const headerPayload = {
        invoice_no: invoiceNo,
        invoice_date: invoiceDate,
        customer_id: customerId,
        reference_name: referenceName.trim(),
        reference_no: referenceNo.trim() || null,
        reference_notes: referenceNotes.trim() || null,
        invoice_type: invoiceType,
        tax_percent: invoiceType === "Tax Invoice" ? Number(configuredTaxRate) || 0 : 0,
        subtotal: Number(rowsSubtotal.toFixed(2)),
        item_tax: Number(itemTax.toFixed(2)),
        charges_total: Number(chargesSubtotal.toFixed(2)),
        charge_tax: Number(chargeTax.toFixed(2)),
        total: Number(grandTotal.toFixed(2)),
        status: "draft",
      };

      if (invoiceId) {
        const { error: updateError } = await supabase.from("consolidated_sales_invoices").update(headerPayload).eq("id", invoiceId);
        if (updateError) throw updateError;
        const [deleteLines, deleteCharges] = await Promise.all([
          supabase.from("consolidated_sales_invoice_lines").delete().eq("invoice_id", invoiceId),
          supabase.from("consolidated_sales_invoice_charges").delete().eq("invoice_id", invoiceId),
        ]);
        if (deleteLines.error) throw deleteLines.error;
        if (deleteCharges.error) throw deleteCharges.error;
      } else {
        const { data, error: insertError } = await supabase.from("consolidated_sales_invoices").insert(headerPayload).select("id").single();
        if (insertError) throw insertError;
        invoiceId = data.id;
        setEditingId(invoiceId);
      }
      if (!invoiceId) throw new Error("Unable to create Consolidated Sales Invoice document.");

      const { error: lineError } = await supabase.from("consolidated_sales_invoice_lines").insert(validRows.map((row) => ({
        invoice_id: invoiceId,
        item_id: row.item_id,
        godown_id: row.godown_id,
        qty: Number(row.qty) || 0,
        unit_price: Number(row.rate) || 0,
        tax_percent: invoiceType === "Tax Invoice" ? Number(row.tax_percent) || 0 : 0,
        description: row.description.trim() || null,
        line_total: (Number(row.qty) || 0) * (Number(row.rate) || 0),
      })));
      if (lineError) throw lineError;

      const activeCharges = charges.filter((row) => Number(row.amount) > 0);
      if (activeCharges.length) {
        const { error: chargeError } = await supabase.from("consolidated_sales_invoice_charges").insert(activeCharges.map((row) => ({ invoice_id: invoiceId, charge_key: row.charge_key, quantity: Number(row.quantity) || 1, rate: Number(row.rate) || 0, amount: Number(row.amount) || 0, tax_percent: invoiceType === "Tax Invoice" ? Number(row.tax_percent) || 0 : 0 })));
        if (chargeError) throw chargeError;
      }
      await loadInvoices();
      setSuccess("Draft saved. This document remains non-accounting until linked to a Main Sales Invoice.");
      return invoiceId;
    } catch (e: any) {
      setError(e?.message || "Failed to save Consolidated Sales Invoice document.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const postStock = async () => {
    if (isLocked) return;
    setPosting(true);
    setError("");
    try {
      const invoiceId = await saveDraft();
      if (!invoiceId) return;
      const { error: rpcError } = await supabase.rpc("post_consolidated_sales_invoice", { p_invoice_id: invoiceId });
      if (rpcError) throw rpcError;
      await loadInvoices();
      setSuccess("Stock posted exactly once. Customer receivable and sales accounting will be recognized only when this document is linked to a Main Sales Invoice.");
      const refreshed = await supabase.from("consolidated_sales_invoices").select("id,invoice_no,invoice_date,customer_id,reference_name,reference_no,reference_notes,invoice_type,tax_percent,item_tax,charges_total,charge_tax,subtotal,total,status,main_sales_order_id,posted_at,customer:customers(id,name,name_urdu)").eq("id", invoiceId).single();
      if (refreshed.data) setInvoices((current) => [refreshed.data as unknown as HawalaInvoice, ...current.filter((row) => row.id !== invoiceId)]);
    } catch (e: any) {
      setError(e?.message || "Failed to post Consolidated Sales Invoice stock.");
    } finally {
      setPosting(false);
    }
  };

  const deleteDraft = async () => {
    if (!editingId || isLocked || !window.confirm("Delete this Consolidated Sales Invoice draft?")) return;
    setSaving(true);
    try {
      const { error: deleteError } = await supabase.from("consolidated_sales_invoices").delete().eq("id", editingId);
      if (deleteError) throw deleteError;
      await loadInvoices();
      resetForm();
      setShowForm(false);
    } catch (e: any) {
      setError(e?.message || "Failed to delete draft.");
    } finally {
      setSaving(false);
    }
  };

  const selectedCustomer = customers.find((row) => row.id === customerId) || null;
  const printItems = rows.filter((row) => row.item_id && Number(row.qty) > 0).map((row) => {
    const item = items.find((candidate) => candidate.id === row.item_id);
    const base = (Number(row.qty) || 0) * (Number(row.rate) || 0);
    return { name: item?.name || "—", description: row.description || null, grade: item?.grade || null, size: item?.size || null, qty: Number(row.qty) || 0, unitPrice: Number(row.rate) || 0, lineTotal: base, taxPercent: invoiceType === "Tax Invoice" ? Number(row.tax_percent) || 0 : undefined, taxAmount: invoiceType === "Tax Invoice" ? (base * (Number(row.tax_percent) || 0)) / 100 : undefined, unit: item?.unit || null };
  });
  const printCharges = charges.filter((row) => Number(row.amount) > 0).map((row) => ({ label: chargeMaster.find((master) => master.charge_key === row.charge_key)?.charge_name || row.charge_key, amount: Number(row.amount) || 0 }));
  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((row) => [row.invoice_no, row.customer?.name, row.reference_name, row.reference_no, row.invoice_date, row.status].some((value) => String(value || "").toLowerCase().includes(q)));
  }, [invoices, search]);

  if (showForm) {
    return <div className="navilo-consolidated-sales-editor space-y-4" data-navilo-document-editor="true" data-navilo-commercial-standard="true">
      <section className="flex flex-col gap-3 border-b border-slate-200 pb-3 xl:flex-row xl:items-center xl:justify-between"><div><button type="button" onClick={() => setShowForm(false)} className="mb-1 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-blue-700"><ArrowLeft className="h-3 w-3" />Consolidated Sales Invoice</button><h1 className="text-xl font-bold text-slate-900">{editingId ? `Consolidated Sales Invoice · ${invoiceNo}` : "New Consolidated Sales Invoice"}</h1><p className="mt-1 text-[12px] text-slate-500">Operational consolidated invoice: stock posts here once; sales receivable, revenue and VAT are recognized later through the linked Main Sales Invoice.</p></div><div className="flex flex-wrap gap-1.5"><button type="button" className="btn-secondary" onClick={() => { setShowPrint(true); window.setTimeout(() => triggerPrint(".print-document"), 50); }}><Printer className="h-3.5 w-3.5" />Preview</button>{editingId && !isLocked && <button type="button" className="btn-danger" onClick={deleteDraft}><Trash2 className="h-3.5 w-3.5" />Delete Draft</button>}{!isLocked && <><button type="button" className="btn-secondary" disabled={saving || posting} onClick={() => void saveDraft()}><Save className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save Draft"}</button><button type="button" className="btn-primary" disabled={saving || posting} onClick={() => void postStock()}><FileCheck2 className="h-3.5 w-3.5" />{posting ? "Posting…" : "Post Stock"}</button></>}{isLocked && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Stock Posted</span>}</div></section>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}{success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{success}</div>}
      <section className="rounded-lg border border-slate-200 bg-white p-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><div><label className="label">Invoice Type</label><SearchableSelect className="input" disabled={isLocked} value={invoiceType} onChange={(e) => changeInvoiceType(e.target.value as InvoiceType)}><option value="Sale Invoice">Without Tax</option><option value="Tax Invoice">With Tax</option></SearchableSelect></div><div><label className="label">Invoice No.</label><input className="input bg-slate-50 font-semibold" readOnly value={invoiceNo} /></div><div><label className="label">Invoice Date</label><input className="input" type="date" disabled={isLocked} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div><div><label className="label">Fixed VAT %</label><input className="input bg-slate-50 text-right" readOnly value={invoiceType === "Tax Invoice" ? configuredTaxRate || "Not configured" : "0"} /></div><div><label className="label">Customer</label><SearchableSelect className="input" disabled={isLocked} value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">— Select customer —</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</SearchableSelect></div><div><label className="label">Hawala / Reference Name</label><input className="input" disabled={isLocked} value={referenceName} onChange={(e) => setReferenceName(e.target.value)} /></div><div><label className="label">Reference No.</label><input className="input" disabled={isLocked} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} /></div><div><label className="label">Remarks</label><input className="input" disabled={isLocked} value={referenceNotes} onChange={(e) => setReferenceNotes(e.target.value)} /></div></div></section>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5"><div><div className="text-[12px] font-semibold text-slate-800">Invoice Items</div><div className="text-[12px] text-slate-400">Item, description, godown, quantity, rate and fixed VAT</div></div>{!isLocked && <button type="button" className="btn-secondary" onClick={() => setRows((current) => [...current, emptyRow(globalTaxPercent, godowns[0]?.id || "")])}><Plus className="h-3.5 w-3.5" />Add Row</button>}</div><div className="space-y-3 p-3 md:hidden">{rows.map((row,index)=>{const base=(Number(row.qty)||0)*(Number(row.rate)||0);const tax=invoiceType==="Tax Invoice"?base*(Number(row.tax_percent)||0)/100:0;return <div key={`mobile-${index}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="mb-3 flex items-center justify-between"><strong className="text-sm">Item {index+1}</strong>{!isLocked&&rows.length>1&&<button type="button" className="text-rose-600" onClick={()=>setRows(current=>current.filter((_,rowIndex)=>rowIndex!==index))}><Trash2 className="h-4 w-4"/></button>}</div><div className="space-y-3"><label className="block text-xs font-semibold text-slate-600">Item<SearchableSelect className="input mt-1" disabled={isLocked} value={row.item_id} onChange={(e)=>updateRow(index,"item_id",e.target.value)}><option value="">— Select item —</option>{items.map(item=><option key={item.id} value={item.id} data-search={item.sku||undefined}>{item.name}</option>)}</SearchableSelect></label><label className="block text-xs font-semibold text-slate-600">Description<input className="input mt-1" disabled={isLocked} value={row.description} onChange={(e)=>updateRow(index,"description",e.target.value)}/></label><label className="block text-xs font-semibold text-slate-600">Godown<SearchableSelect className="input mt-1" disabled={isLocked} value={row.godown_id} onChange={(e)=>updateRow(index,"godown_id",e.target.value)}><option value="">— Select godown —</option>{godowns.map(godown=><option key={godown.id} value={godown.id}>{godown.name}</option>)}</SearchableSelect></label><div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-slate-600">Qty<input className="input mt-1 text-right" type="number" step="0.001" disabled={isLocked} value={row.qty} onChange={(e)=>updateRow(index,"qty",e.target.value)}/></label><label className="block text-xs font-semibold text-slate-600">Rate<input className="input mt-1 text-right" type="number" step="0.01" disabled={isLocked} value={row.rate} onChange={(e)=>updateRow(index,"rate",e.target.value)}/></label></div>{invoiceType==="Tax Invoice"&&<div className="flex justify-between text-sm"><span>VAT {Number(row.tax_percent)||0}%</span><span>{money(tax)}</span></div>}<div className="flex justify-between border-t pt-3 text-sm"><span className="text-slate-500">Amount</span><strong>{money(base+tax)}</strong></div></div></div>;})}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[940px] text-[12px]"><thead className="bg-slate-50"><tr className="border-b border-slate-200"><th className="px-3 py-2 text-left">Item</th><th className="px-2 py-2 text-left">Description</th><th className="px-2 py-2 text-left">Godown</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Rate</th>{invoiceType === "Tax Invoice" && <th className="px-2 py-2 text-right">VAT %</th>}<th className="px-2 py-2 text-right">Amount</th><th className="w-10" /></tr></thead><tbody>{rows.map((row,index) => { const base=(Number(row.qty)||0)*(Number(row.rate)||0); const tax=invoiceType === "Tax Invoice" ? base*(Number(row.tax_percent)||0)/100 : 0; return <tr key={index} className="border-b border-slate-100"><td className="px-3 py-2"><SearchableSelect className="input" disabled={isLocked} value={row.item_id} onChange={(e) => updateRow(index,"item_id",e.target.value)}><option value="">— Select item —</option>{items.map((item) => <option key={item.id} value={item.id} data-search={item.sku||undefined}>{item.name}</option>)}</SearchableSelect></td><td className="px-2 py-2"><input className="input" disabled={isLocked} value={row.description} onChange={(e) => updateRow(index,"description",e.target.value)} /></td><td className="px-2 py-2"><SearchableSelect className="input" disabled={isLocked} value={row.godown_id} onChange={(e) => updateRow(index,"godown_id",e.target.value)}><option value="">— Select godown —</option>{godowns.map((godown) => <option key={godown.id} value={godown.id}>{godown.name}</option>)}</SearchableSelect></td><td className="px-2 py-2"><input className="input text-right" type="number" step="0.001" disabled={isLocked} value={row.qty} onChange={(e) => updateRow(index,"qty",e.target.value)} /></td><td className="px-2 py-2"><input className="input text-right" type="number" step="0.01" disabled={isLocked} value={row.rate} onChange={(e) => updateRow(index,"rate",e.target.value)} /></td>{invoiceType === "Tax Invoice" && <td className="px-2 py-2"><input className="input bg-slate-50 text-right" readOnly value={row.tax_percent} /></td>}<td className="px-2 py-2 text-right font-semibold">{money(base+tax)}</td><td className="px-2 py-2">{!isLocked && rows.length>1 && <button type="button" className="text-rose-600" onClick={() => setRows((current) => current.filter((_,rowIndex)=>rowIndex!==index))}><Trash2 className="h-3.5 w-3.5" /></button>}</td></tr>; })}</tbody></table></div></section>
      <section className="rounded-lg border border-slate-200 bg-white"><div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[12px] font-semibold text-slate-800">Applicable Charges</div><div className="text-[12px] text-slate-400">Rates and calculation basis come from Charge Master.</div></div>{!isLocked && <div className="flex gap-1.5"><SearchableSelect className="input min-w-[220px]" value={chargeToAdd} onChange={(e) => setChargeToAdd(e.target.value)}><option value="">— Select charge —</option>{chargeMaster.filter((master) => !charges.some((row) => row.charge_key===master.charge_key)).map((master) => <option key={master.id} value={master.charge_key}>{master.charge_name}</option>)}</SearchableSelect><button type="button" className="btn-secondary" onClick={addCharge}><Plus className="h-3.5 w-3.5" />Add</button></div>}</div><div className="grid gap-2 p-3 md:grid-cols-2">{!charges.length ? <div className="text-[12px] text-slate-400">No additional charges.</div> : charges.map((charge,index) => { const master=chargeMaster.find((row)=>row.charge_key===charge.charge_key); return <div key={charge.charge_key} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between"><strong className="text-[12px]">{master?.charge_name || charge.charge_key}</strong>{!isLocked && <button type="button" className="text-rose-600" onClick={() => setCharges((current)=>current.filter((_,rowIndex)=>rowIndex!==index))}><X className="h-3.5 w-3.5" /></button>}</div><div className="grid grid-cols-2 gap-2"><div><label className="label">Qty / Basis</label><input className="input bg-slate-100 text-right" readOnly value={charge.quantity} /></div><div><label className="label">Rate</label><input className="input text-right" type="number" step="0.01" disabled={isLocked || Boolean(master?.is_fixed)} value={charge.rate} onChange={(e) => setCharges((current)=>current.map((candidate,rowIndex)=>rowIndex===index ? recalculateCharge(candidate,e.target.value) : candidate))} /></div><div><label className="label">Amount</label><input className="input bg-slate-100 text-right" readOnly value={charge.amount} /></div>{invoiceType === "Tax Invoice" && master?.tax_applicable && <div><label className="label">VAT %</label><input className="input bg-slate-100 text-right" readOnly value={charge.tax_percent} /></div>}</div></div>; })}</div></section>
      <section className="ml-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-3 text-[12px]"><div className="flex justify-between py-1"><span>Items Subtotal</span><strong>{money(rowsSubtotal)}</strong></div>{invoiceType === "Tax Invoice" && <div className="flex justify-between py-1"><span>Item VAT</span><strong>{money(itemTax)}</strong></div>}<div className="flex justify-between py-1"><span>Charges</span><strong>{money(chargesSubtotal)}</strong></div>{invoiceType === "Tax Invoice" && <div className="flex justify-between py-1"><span>Charge VAT</span><strong>{money(chargeTax)}</strong></div>}<div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm"><span className="font-semibold">Grand Total</span><strong>{money(grandTotal)}</strong></div></section>
      {showPrint && <PrintLayout voucherTitle="Consolidated Invoice" voucherNo={invoiceNo} voucherDate={invoiceDate} company={{ name: companyPrint.company_name || "NAVILO", address: companyPrint.address || undefined, phone: companyPrint.phone || undefined, email: companyPrint.email || undefined, taxId: [companyPrint.ntn ? `NTN: ${companyPrint.ntn}` : "", companyPrint.strn ? `STRN: ${companyPrint.strn}` : ""].filter(Boolean).join(" | ") || undefined, logoUrl: companyPrint.logo_url || undefined }} party={{ name: selectedCustomer?.name || "—", address: selectedCustomer?.address, phone: selectedCustomer?.phone, email: selectedCustomer?.email, ntn: selectedCustomer?.ntn, strn: selectedCustomer?.strn }} items={printItems} chargeBreakdown={printCharges} itemsTotal={rowsSubtotal} chargesTotal={chargesSubtotal} taxAmount={itemTax+chargeTax} showTaxSummary={invoiceType === "Tax Invoice"} grandTotal={grandTotal} extraFields={[{ label: "Reference Name", value: referenceName || "—" },{ label: "Reference No.", value: referenceNo || "—" },...(referenceNotes ? [{ label: "Remarks", value: referenceNotes }] : [])]} documentHeader={companyPrint.document_header || undefined} documentHeaderUrdu={companyPrint.document_header_urdu || undefined} documentFooter={companyPrint.document_footer || undefined} documentFooterUrdu={companyPrint.document_footer_urdu || undefined} signatureLabels={[companyPrint.prepared_by_label || "Prepared By",companyPrint.checked_by_label || "Checked By",companyPrint.approved_by_label || "Approved By"]} />}
    </div>;
  }

  return <div className="space-y-3" data-navilo-commercial-standard="true"><section className="flex flex-col gap-3 border-b border-slate-200 pb-3 lg:flex-row lg:items-center lg:justify-between"><div><Link to="/sales" className="mb-1 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-blue-700"><ArrowLeft className="h-3 w-3" />Sales</Link><h1 className="text-xl font-bold text-slate-900">Consolidated Sales Invoice</h1><p className="text-[12px] text-slate-500">Separate unbilled dispatch documents. Stock posts here; accounting posts only through the linked Main Sales Invoice.</p></div><div className="flex flex-wrap gap-1.5"><span data-navilo-standard-tools-host className="contents" /><button type="button" className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}><Plus className="h-3.5 w-3.5" />New Consolidated Sales Invoice</button></div></section>{error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>}<div className="relative max-w-md"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><input className="input pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search document, customer or reference…" /></div><section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-[12px]"><thead className="bg-slate-50"><tr className="border-b border-slate-200"><th className="px-3 py-2 text-left">Hawala No.</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Reference</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-center">Status</th><th className="px-3 py-2 text-right">Action</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr> : !filteredInvoices.length ? <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No Consolidated Sales Invoice documents found.</td></tr> : filteredInvoices.map((invoice) => <tr key={invoice.id} className="border-b border-slate-100"><td className="px-3 py-2 font-semibold">{invoice.invoice_no}</td><td className="px-3 py-2">{invoice.invoice_date}</td><td className="px-3 py-2">{invoice.customer?.name || "—"}</td><td className="px-3 py-2"><div className="font-medium">{invoice.reference_name || "—"}</div>{invoice.reference_no && <div className="text-[12px] text-slate-400">{invoice.reference_no}</div>}</td><td className="px-3 py-2 text-right font-semibold">{money(invoice.total)}</td><td className="px-3 py-2 text-center"><span className={invoice.status === "posted" ? "rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700" : "rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700"}>{invoice.status}</span></td><td className="px-3 py-2 text-right"><button type="button" className="btn-secondary" onClick={() => void openInvoice(invoice)}>{invoice.status === "posted" ? "View" : "Open / Edit"}</button></td></tr>)}</tbody></table></div></section></div>;
}
