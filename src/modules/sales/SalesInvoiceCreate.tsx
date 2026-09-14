import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, FileCheck2, Plus, Printer, Save, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorBanner, Modal, formatCurrency } from "@/components/ui";
import PrintLayout from "@/components/PrintLayout";
import UnifiedOrderBookInvoicePicker from "@/components/UnifiedOrderBookInvoicePicker";
import SalesOrderBookDraftBridge from "@/components/SalesOrderBookDraftBridge";
import { calculateConfiguredChargeAmount, chargeQuantityForUnit } from "@/lib/chargeCalculation";
import { triggerPrint } from "@/lib/exportUtils";
import { supabase } from "@/lib/supabase";

type InvoiceType = "Sale Invoice" | "Tax Invoice";

type Customer = {
  id: string;
  name: string;
  name_urdu?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  ntn?: string | null;
  strn?: string | null;
  cnic?: string | null;
  tax_registration_status?: string | null;
};

type Item = {
  id: string;
  name: string;
  name_urdu?: string | null;
  sku?: string | null;
  grade?: string | null;
  size?: string | null;
  unit?: string | null;
  price?: number | string | null;
  weight_per_piece?: number | string | null;
};

type Godown = { id: string; name: string; name_urdu?: string | null };
type SalesPerson = { id: string; name: string; employee_code?: string | null; designation?: string | null; department?: string | null };

type ChargeMaster = {
  id: string;
  charge_key: string;
  charge_name: string;
  default_rate: number | string;
  unit: "fixed" | "percent" | "per_kg" | "per_ton" | "per_piece";
  tax_applicable: boolean;
  is_fixed: boolean;
  revenue_account_id?: string | null;
  cost_account_id?: string | null;
};

type CompanyPrintSettings = {
  company_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  ntn?: string | null;
  strn?: string | null;
  logo_url?: string | null;
  document_header?: string | null;
  document_header_urdu?: string | null;
  document_footer?: string | null;
  document_footer_urdu?: string | null;
  prepared_by_label?: string | null;
  checked_by_label?: string | null;
  approved_by_label?: string | null;
};

type InvoiceRow = {
  item_id: string;
  godown_id: string;
  qty: string;
  rate: string;
  tax_percent: string;
  description: string;
};

type ChargeRow = {
  charge_key: string;
  quantity: string;
  rate: string;
  amount: string;
  tax_percent: string;
};

type HawalaOption = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  reference_name: string | null;
  reference_no: string | null;
  reference_notes?: string | null;
  total: number | string;
  linked_sales_order_id: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyRow = (tax = "0", godownId = ""): InvoiceRow => ({
  item_id: "",
  godown_id: godownId,
  qty: "0",
  rate: "0",
  tax_percent: tax,
  description: "",
});

export default function SalesInvoiceCreate() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [salesPersons, setSalesPersons] = useState<SalesPerson[]>([]);
  const [chargeMaster, setChargeMaster] = useState<ChargeMaster[]>([]);
  const [companyPrint, setCompanyPrint] = useState<CompanyPrintSettings>({});

  const [invoiceNo, setInvoiceNo] = useState("Loading…");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("Sale Invoice");
  const [customerId, setCustomerId] = useState("");
  const [salesPersonId, setSalesPersonId] = useState("");
  const [salesPerson, setSalesPerson] = useState("");
  const [referenceName, setReferenceName] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [referenceNotes, setReferenceNotes] = useState("");
  const [configuredTaxRate, setConfiguredTaxRate] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState("0");
  const [rows, setRows] = useState<InvoiceRow[]>([emptyRow()]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [chargeToAdd, setChargeToAdd] = useState("");

  const [hawalaOptions, setHawalaOptions] = useState<HawalaOption[]>([]);
  const [selectedHawalaIds, setSelectedHawalaIds] = useState<string[]>([]);
  const [hawalaSearch, setHawalaSearch] = useState("");
  const [hawalaLoading, setHawalaLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taxPercent = invoiceType === "Tax Invoice" ? Number(configuredTaxRate || 0) : 0;

  const loadNextInvoiceNo = useCallback(async (type: InvoiceType) => {
    if (isEditing) return;
    const { data, error: numberError } = await supabase.rpc("preview_next_sales_invoice_number", { p_invoice_type: type });
    if (numberError) {
      setError(numberError.message);
      setInvoiceNo(type === "Tax Invoice" ? "TAX" : "INV");
      return;
    }
    setInvoiceNo(String(data || (type === "Tax Invoice" ? "TAX" : "INV")));
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) void loadNextInvoiceNo(invoiceType);
  }, [invoiceType, isEditing, loadNextInvoiceNo]);

  const loadBaseData = useCallback(async () => {
    const [customersRes, itemsRes, godownsRes, peopleRes, chargesRes, taxRes, companyRes] = await Promise.all([
      supabase.from("customers").select("id,name,name_urdu,address,phone,email,ntn,strn,cnic,tax_registration_status").eq("is_active", true).order("name"),
      supabase.from("items").select("id,name,name_urdu,sku,grade,size,unit,price,weight_per_piece").order("name"),
      supabase.from("godowns").select("id,name,name_urdu").order("name"),
      supabase.from("employees").select("id,name,employee_code,designation,department").eq("is_active", true).order("name"),
      supabase.from("charge_master").select("id,charge_key,charge_name,default_rate,unit,tax_applicable,is_fixed,revenue_account_id,cost_account_id").eq("is_active", true).in("applies_to", ["sales", "both"]).order("charge_name"),
      supabase.from("tax_rates").select("rate").eq("is_active", true).eq("is_fixed", true).in("applies_to", ["sales", "both"]).order("created_at").limit(1).maybeSingle(),
      supabase.from("company_settings").select("*").maybeSingle(),
    ]);

    const firstError = [customersRes.error, itemsRes.error, godownsRes.error, peopleRes.error, chargesRes.error, taxRes.error, companyRes.error].find(Boolean);
    if (firstError) throw firstError;

    const loadedGodowns = (godownsRes.data ?? []) as Godown[];
    const configuredRate = taxRes.data ? String(Number(taxRes.data.rate) || 0) : null;

    setCustomers((customersRes.data ?? []) as Customer[]);
    setItems((itemsRes.data ?? []) as Item[]);
    setGodowns(loadedGodowns);
    setSalesPersons((peopleRes.data ?? []) as SalesPerson[]);
    setChargeMaster((chargesRes.data ?? []) as ChargeMaster[]);
    setCompanyPrint((companyRes.data || {}) as CompanyPrintSettings);
    setConfiguredTaxRate(configuredRate);

    if (!isEditing) {
      setRows((current) => current.map((row) => ({
        ...row,
        godown_id: row.godown_id || loadedGodowns[0]?.id || "",
        tax_percent: invoiceType === "Tax Invoice" ? configuredRate || "0" : "0",
      })));
    }
  }, [invoiceType, isEditing]);

  const loadEditingInvoice = useCallback(async () => {
    if (!id) return;

    const [headerRes, linesRes, chargesRes] = await Promise.all([
      supabase.from("sales_orders").select("*").eq("id", id).single(),
      supabase.from("sales_order_lines").select("item_id,godown_id,qty,unit_price,tax_percent,description").eq("order_id", id),
      supabase.from("sales_order_charges").select("charge_key,quantity,rate,amount,tax_percent").eq("order_id", id),
    ]);

    if (headerRes.error) throw headerRes.error;
    if (linesRes.error) throw linesRes.error;
    if (chargesRes.error) throw chargesRes.error;

    const header = headerRes.data;
    const canonicalType: InvoiceType = header.invoice_type === "Tax Invoice" ? "Tax Invoice" : "Sale Invoice";
    setInvoiceNo(header.order_no || "Unassigned");
    setInvoiceDate(header.order_date || today());
    setInvoiceType(canonicalType);
    setCustomerId(header.customer_id || "");
    setSalesPersonId("");
    setSalesPerson(header.sales_person || "");
    setReferenceName(header.reference_name || "");
    setReferenceNo(header.reference_no || "");
    setReferenceNotes(header.reference_notes || "");
    setConfiguredTaxRate(canonicalType === "Tax Invoice" ? String(Number(header.tax_percent) || 0) : null);
    setDiscountAmount(String(Number(header.discount_amount) || 0));
    setIsLocked(header.status === "posted" || header.status === "closed");

    setRows((linesRes.data ?? []).length
      ? (linesRes.data ?? []).map((line: any) => ({
          item_id: line.item_id || "",
          godown_id: line.godown_id || "",
          qty: String(line.qty ?? 0),
          rate: String(line.unit_price ?? 0),
          tax_percent: String(line.tax_percent ?? 0),
          description: line.description || "",
        }))
      : [emptyRow(canonicalType === "Tax Invoice" ? String(Number(header.tax_percent) || 0) : "0")]);

    setCharges((chargesRes.data ?? []).map((charge: any) => ({
      charge_key: charge.charge_key,
      quantity: String(charge.quantity ?? 1),
      rate: String(charge.rate ?? charge.amount ?? 0),
      amount: String(charge.amount ?? 0),
      tax_percent: String(charge.tax_percent ?? 0),
    })));
  }, [id]);

  useEffect(() => {
    void (async () => {
      try {
        setError(null);
        await loadBaseData();
        await loadEditingInvoice();
      } catch (e: any) {
        setError(e?.message || "Failed to load sales invoice.");
      }
    })();
  }, [loadBaseData, loadEditingInvoice]);

  useEffect(() => {
    if (!salesPerson || salesPersonId || !salesPersons.length) return;
    const match = salesPersons.find((row) => row.name.trim().toLowerCase() === salesPerson.trim().toLowerCase());
    if (match) setSalesPersonId(match.id);
  }, [salesPerson, salesPersonId, salesPersons]);

  useEffect(() => {
    if (!customerId) {
      setHawalaOptions([]);
      setSelectedHawalaIds([]);
      return;
    }

    void (async () => {
      setHawalaLoading(true);
      const { data, error: hawalaError } = await supabase.rpc("get_available_hawala_invoices", {
        p_customer_id: customerId,
        p_order_id: id || null,
      });
      setHawalaLoading(false);
      if (hawalaError) {
        setError(hawalaError.message);
        return;
      }
      const loaded = (data ?? []) as HawalaOption[];
      setHawalaOptions(loaded);
      if (id) setSelectedHawalaIds(loaded.filter((row) => row.linked_sales_order_id === id).map((row) => row.id));
    })();
  }, [customerId, id]);

  const rowsSubtotal = rows.reduce((sum, row) => sum + (Number(row.qty) || 0) * (Number(row.rate) || 0), 0);
  const itemTax = invoiceType === "Tax Invoice"
    ? rows.reduce((sum, row) => {
        const base = (Number(row.qty) || 0) * (Number(row.rate) || 0);
        return sum + (base * (Number(row.tax_percent) || 0)) / 100;
      }, 0)
    : 0;
  const chargesSubtotal = charges.reduce((sum, charge) => sum + (Number(charge.amount) || 0), 0);
  const chargeTax = invoiceType === "Tax Invoice"
    ? charges.reduce((sum, charge) => sum + ((Number(charge.amount) || 0) * (Number(charge.tax_percent) || 0)) / 100, 0)
    : 0;
  const normalInvoiceTotal = rowsSubtotal + itemTax + chargesSubtotal + chargeTax;
  const selectedHawalaInvoices = hawalaOptions.filter((row) => selectedHawalaIds.includes(row.id));
  const selectedHawalaTotal = selectedHawalaInvoices.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const grossTotal = normalInvoiceTotal + selectedHawalaTotal;
  const discountValue = Math.max(0, Number(discountAmount) || 0);
  const grandTotal = Math.max(0, grossTotal - discountValue);

  const selectedCustomer = useMemo(() => customers.find((row) => row.id === customerId) || null, [customers, customerId]);

  const changeInvoiceType = (next: InvoiceType) => {
    if (isLocked) return;
    setInvoiceType(next);
    const nextTax = next === "Tax Invoice" ? configuredTaxRate || "0" : "0";
    setRows((current) => current.map((row) => ({ ...row, tax_percent: nextTax })));
    setCharges((current) => current.map((charge) => ({
      ...charge,
      tax_percent: next === "Tax Invoice" && chargeMaster.find((master) => master.charge_key === charge.charge_key)?.tax_applicable ? nextTax : "0",
    })));
  };

  const updateRow = (index: number, field: keyof InvoiceRow, value: string) => {
    if (isLocked) return;
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, [field]: value };
      if (field === "item_id") {
        const item = items.find((candidate) => candidate.id === value);
        if (item) next.rate = String(Number(item.price) || 0);
      }
      return next;
    }));
  };

  const recalculateCharge = (charge: ChargeRow, nextRate?: string) => {
    const master = chargeMaster.find((row) => row.charge_key === charge.charge_key);
    if (!master) return charge;
    const rate = Number(nextRate ?? charge.rate ?? master.default_rate) || 0;
    const quantity = chargeQuantityForUnit(master.unit, rows as any, items as any, rowsSubtotal);
    const amount = calculateConfiguredChargeAmount({ unit: master.unit, rate, rows: rows as any, items: items as any, baseAmount: rowsSubtotal });
    return { ...charge, quantity: String(Number(quantity.toFixed(3))), rate: String(rate), amount: String(Number(amount.toFixed(2))) };
  };

  useEffect(() => {
    if (isLocked || charges.length === 0) return;
    setCharges((current) => current.map((charge) => recalculateCharge(charge)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSubtotal, rows, items]);

  const addCharge = () => {
    if (!chargeToAdd || isLocked || charges.some((row) => row.charge_key === chargeToAdd)) return;
    const master = chargeMaster.find((row) => row.charge_key === chargeToAdd);
    if (!master) return;
    const tax = invoiceType === "Tax Invoice" && master.tax_applicable ? String(taxPercent) : "0";
    const base: ChargeRow = { charge_key: master.charge_key, quantity: "1", rate: String(Number(master.default_rate) || 0), amount: "0", tax_percent: tax };
    setCharges((current) => [...current, recalculateCharge(base)]);
    setChargeToAdd("");
  };

  const saveDraft = async () => {
    if (isLocked) {
      setError("Posted or closed invoices are immutable. Use the approved reversal/return workflow for corrections.");
      return;
    }
    if (!customerId) return setError("Select a customer.");
    if (!salesPersonId || !salesPerson) return setError("Select a sales person from Employee Master.");
    if (discountValue > grossTotal) return setError("Discount cannot exceed the invoice gross total.");
    if (invoiceType === "Tax Invoice" && !configuredTaxRate) return setError("Configure one active fixed Sales/Both tax rate in Tax Settings before using With Tax.");

    const validRows = rows.filter((row) => row.item_id && Number(row.qty) > 0);
    if (!validRows.length && !selectedHawalaIds.length) return setError("Add at least one item or link a posted Consolidated / Hawala document.");
    if (validRows.some((row) => !row.godown_id)) return setError("Select a godown for every physical item line.");

    setSaving(true);
    setError(null);
    try {
      const headerPayload = {
        customer_id: customerId,
        sales_person: salesPerson,
        sales_person_account_id: null,
        order_date: invoiceDate,
        status: "draft",
        total: Number(grossTotal.toFixed(2)),
        discount_amount: Number(discountValue.toFixed(2)),
        reference_name: referenceName.trim() || null,
        reference_no: referenceNo.trim() || null,
        reference_notes: referenceNotes.trim() || null,
        invoice_type: invoiceType,
        payment_mode: "Credit",
        tax_percent: invoiceType === "Tax Invoice" ? taxPercent : 0,
      };

      let orderId = id || null;
      let savedOrderNo = invoiceNo;
      if (orderId) {
        const { error: updateError } = await supabase.from("sales_orders").update(headerPayload).eq("id", orderId);
        if (updateError) throw updateError;
        const [deleteLines, deleteCharges] = await Promise.all([
          supabase.from("sales_order_lines").delete().eq("order_id", orderId),
          supabase.from("sales_order_charges").delete().eq("order_id", orderId),
        ]);
        if (deleteLines.error) throw deleteLines.error;
        if (deleteCharges.error) throw deleteCharges.error;
      } else {
        const { data, error: insertError } = await supabase.from("sales_orders").insert({ order_no: null, ...headerPayload }).select("id,order_no").single();
        if (insertError) throw insertError;
        orderId = data.id;
        savedOrderNo = data.order_no || invoiceNo;
        setInvoiceNo(savedOrderNo);
      }

      if (!orderId) throw new Error("Sales invoice ID was not created.");

      if (validRows.length) {
        const { error: linesError } = await supabase.from("sales_order_lines").insert(validRows.map((row) => ({
          order_id: orderId,
          item_id: row.item_id,
          godown_id: row.godown_id,
          qty: Number(row.qty) || 0,
          unit_price: Number(row.rate) || 0,
          tax_percent: invoiceType === "Tax Invoice" ? Number(row.tax_percent) || 0 : 0,
          description: row.description.trim() || null,
          line_total: (Number(row.qty) || 0) * (Number(row.rate) || 0),
        })));
        if (linesError) throw linesError;
      }

      const activeCharges = charges.filter((row) => Number(row.amount) > 0);
      if (activeCharges.length) {
        const { error: chargeError } = await supabase.from("sales_order_charges").insert(activeCharges.map((charge) => {
          const master = chargeMaster.find((row) => row.charge_key === charge.charge_key);
          return {
            order_id: orderId,
            charge_key: charge.charge_key,
            charge_label: master?.charge_name || charge.charge_key,
            quantity: Number(charge.quantity) || 1,
            rate: Number(charge.rate) || 0,
            amount: Number(charge.amount) || 0,
            tax_percent: invoiceType === "Tax Invoice" && master?.tax_applicable ? Number(charge.tax_percent) || 0 : 0,
            account_id: master?.revenue_account_id || null,
            cost_account_id: master?.cost_account_id || null,
            cost_amount: 0,
          };
        }));
        if (chargeError) throw chargeError;
      }

      const { error: discountError } = await supabase.rpc("upsert_commercial_invoice_discount", {
        p_document_type: "sales_main",
        p_document_no: savedOrderNo,
        p_mode: "fixed",
        p_value: Number(discountValue.toFixed(2)),
        p_amount: Number(discountValue.toFixed(2)),
      });
      if (discountError) throw discountError;

      const { error: totalSyncError } = await supabase.from("sales_orders").update({
        total: Number(grossTotal.toFixed(2)),
        discount_amount: Number(discountValue.toFixed(2)),
      }).eq("id", orderId).eq("status", "draft");
      if (totalSyncError) throw totalSyncError;

      const { error: linkError } = await supabase.rpc("replace_sales_order_hawala_invoices", {
        p_order_id: orderId,
        p_hawala_invoice_ids: selectedHawalaIds,
      });
      if (linkError) throw linkError;

      navigate(`/sales/${orderId}`);
    } catch (e: any) {
      setError(e?.message || "Failed to save sales invoice.");
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!id || isLocked || !window.confirm("Delete this draft sales invoice?")) return;
    setSaving(true);
    try {
      const { error: deleteError } = await supabase.from("sales_orders").delete().eq("id", id);
      if (deleteError) throw deleteError;
      navigate("/sales");
    } catch (e: any) {
      setError(e?.message || "Failed to delete draft invoice.");
    } finally {
      setSaving(false);
    }
  };

  const printItems = rows.filter((row) => row.item_id && Number(row.qty) > 0).map((row) => {
    const item = items.find((candidate) => candidate.id === row.item_id);
    const base = (Number(row.qty) || 0) * (Number(row.rate) || 0);
    const lineTax = invoiceType === "Tax Invoice" ? (base * (Number(row.tax_percent) || 0)) / 100 : 0;
    return {
      name: item?.name || "—",
      description: row.description || null,
      grade: item?.grade || null,
      size: item?.size || null,
      qty: Number(row.qty) || 0,
      unitPrice: Number(row.rate) || 0,
      lineTotal: base,
      taxPercent: invoiceType === "Tax Invoice" ? Number(row.tax_percent) || 0 : undefined,
      taxAmount: invoiceType === "Tax Invoice" ? lineTax : undefined,
      unit: item?.unit || null,
    };
  });

  const printCharges = charges.filter((row) => Number(row.amount) > 0).map((row) => ({
    label: chargeMaster.find((master) => master.charge_key === row.charge_key)?.charge_name || row.charge_key,
    amount: Number(row.amount) || 0,
  }));

  return (
    <div className="space-y-3">
      <section className="flex flex-col gap-3 border-b border-slate-200 pb-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <button type="button" onClick={() => navigate("/sales")} className="mb-1 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-blue-700">
            <ArrowLeft className="h-3 w-3" /> Sales Invoices
          </button>
          <h1 className="text-xl font-bold text-slate-900">{isEditing ? `${invoiceType} · ${invoiceNo}` : "New Sales Invoice"}</h1>
          <p className="mt-1 text-[12px] text-slate-500">Canonical document classification: Without Tax or With Tax. Settlement is recorded separately through receipts.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isEditing && !isLocked && <button type="button" className="btn-danger" onClick={deleteDraft}><Trash2 className="h-3.5 w-3.5" />Delete Draft</button>}
          <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(true)}><Eye className="h-3.5 w-3.5" />Preview</button>
          {!isLocked && <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveDraft()}><FileCheck2 className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save Draft"}</button>}
        </div>
      </section>

      {error && <ErrorBanner message={error} />}
      {isLocked && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Posted/closed invoice is locked. Financial corrections must use reversal, return, credit-note or debit-note workflows.</div>}

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div><label className="label">Invoice Type</label><SearchableSelect className="input" disabled={isLocked} value={invoiceType} onChange={(e) => changeInvoiceType(e.target.value as InvoiceType)}><option value="Sale Invoice">Without Tax</option><option value="Tax Invoice">With Tax</option></SearchableSelect></div>
          <div><label className="label">Invoice No.</label><input className="input bg-slate-50 font-semibold" readOnly value={invoiceNo} /></div>
          <div><label className="label">Invoice Date</label><input className="input" type="date" disabled={isLocked} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          <div><label className="label">Fixed VAT %</label><input className="input bg-slate-50 text-right" readOnly value={invoiceType === "Tax Invoice" ? configuredTaxRate || "Not configured" : "0"} /></div>
          <div><label className="label">Customer</label><SearchableSelect className="input" disabled={isLocked} value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">— Select customer —</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.name_urdu ? ` / ${customer.name_urdu}` : ""}</option>)}</SearchableSelect></div>
          <div><label className="label">Sales Person</label><SearchableSelect className="input" disabled={isLocked} value={salesPersonId} onChange={(e) => { const nextId = e.target.value; const selected = salesPersons.find((row) => row.id === nextId); setSalesPersonId(nextId); setSalesPerson(selected?.name || ""); }}><option value="">— Select sales person —</option>{salesPersons.map((person) => <option key={person.id} value={person.id}>{person.name}{person.employee_code ? ` · ${person.employee_code}` : ""}{person.designation ? ` · ${person.designation}` : ""}</option>)}</SearchableSelect></div>
          <div><label className="label">Reference Name</label><input className="input" disabled={isLocked} value={referenceName} onChange={(e) => setReferenceName(e.target.value)} /></div>
          <div><label className="label">Reference No.</label><input className="input" disabled={isLocked} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} /></div>
          <div className="sm:col-span-2 xl:col-span-4"><label className="label">Remarks</label><input className="input" disabled={isLocked} value={referenceNotes} onChange={(e) => setReferenceNotes(e.target.value)} /></div>
        </div>
      </section>

      {customerId && <section className="rounded-lg border border-blue-200 bg-white">
        <div className="border-b border-blue-100 bg-blue-50 px-3 py-2.5"><div className="text-[12px] font-semibold text-blue-900">Link posted Consolidated / Hawala documents</div><div className="text-[12px] text-blue-700">Linked documents are included in the main receivable once; their physical stock movement is not repeated.</div></div>
        <div className="p-3"><input className="input mb-2" placeholder="Search consolidated document…" value={hawalaSearch} onChange={(e) => setHawalaSearch(e.target.value)} />{hawalaLoading ? <div className="text-[12px] text-slate-400">Loading…</div> : <div className="max-h-56 overflow-auto rounded border border-slate-200">{hawalaOptions.filter((row) => [row.invoice_no,row.reference_name,row.reference_no].some((value) => String(value || "").toLowerCase().includes(hawalaSearch.toLowerCase()))).map((row) => <label key={row.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2"><input type="checkbox" disabled={isLocked} checked={selectedHawalaIds.includes(row.id)} onChange={() => setSelectedHawalaIds((current) => current.includes(row.id) ? current.filter((candidate) => candidate !== row.id) : [...current, row.id])} /><div className="min-w-0 flex-1"><div className="font-semibold text-slate-800">{row.invoice_no}</div><div className="text-[12px] text-slate-400">{row.reference_name || "No reference"} · {row.invoice_date}</div></div><strong>{formatCurrency(Number(row.total) || 0)}</strong></label>)}</div>}</div>
      </section>}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5"><div><div className="text-[12px] font-semibold text-slate-800">Invoice Items</div><div className="text-[12px] text-slate-400">Item, description, godown, quantity, rate and fixed VAT</div></div>{!isLocked && <div className="flex flex-wrap gap-2">{isEditing && id ? <SalesOrderBookDraftBridge invoiceId={id} onChanged={() => void loadEditingInvoice()} /> : <UnifiedOrderBookInvoicePicker kind="sales" />}<button type="button" className="btn-secondary" onClick={() => setRows((current) => [...current, emptyRow(invoiceType === "Tax Invoice" ? configuredTaxRate || "0" : "0", godowns[0]?.id || "")])}><Plus className="h-3.5 w-3.5" />Add Row</button></div>}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-[12px]"><thead className="bg-slate-50"><tr className="border-b border-slate-200"><th className="px-3 py-2 text-left">Item</th><th className="px-2 py-2 text-left">Description</th><th className="px-2 py-2 text-left">Godown</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Rate</th>{invoiceType === "Tax Invoice" && <th className="px-2 py-2 text-right">VAT %</th>}<th className="px-2 py-2 text-right">Amount</th><th className="w-10" /></tr></thead><tbody>{rows.map((row,index) => { const base=(Number(row.qty)||0)*(Number(row.rate)||0); const lineTax=invoiceType === "Tax Invoice" ? base*(Number(row.tax_percent)||0)/100 : 0; return <tr key={index} className="border-b border-slate-100"><td className="px-3 py-2"><SearchableSelect className="input" disabled={isLocked} value={row.item_id} onChange={(e) => updateRow(index,"item_id",e.target.value)}><option value="">— Select item —</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}{item.sku ? ` · ${item.sku}` : ""}</option>)}</SearchableSelect></td><td className="px-2 py-2"><input className="input" disabled={isLocked} value={row.description} onChange={(e) => updateRow(index,"description",e.target.value)} /></td><td className="px-2 py-2"><SearchableSelect className="input" disabled={isLocked} value={row.godown_id} onChange={(e) => updateRow(index,"godown_id",e.target.value)}><option value="">— Select godown —</option>{godowns.map((godown) => <option key={godown.id} value={godown.id}>{godown.name}</option>)}</SearchableSelect></td><td className="px-2 py-2"><input className="input text-right" type="number" step="0.001" disabled={isLocked} value={row.qty} onChange={(e) => updateRow(index,"qty",e.target.value)} /></td><td className="px-2 py-2"><input className="input text-right" type="number" step="0.01" disabled={isLocked} value={row.rate} onChange={(e) => updateRow(index,"rate",e.target.value)} /></td>{invoiceType === "Tax Invoice" && <td className="px-2 py-2"><input className="input bg-slate-50 text-right" readOnly value={row.tax_percent} /></td>}<td className="px-2 py-2 text-right font-semibold">{formatCurrency(base+lineTax)}</td><td className="px-2 py-2">{!isLocked && rows.length>1 && <button type="button" className="text-rose-600" onClick={() => setRows((current) => current.filter((_,rowIndex) => rowIndex !== index))}><Trash2 className="h-3.5 w-3.5" /></button>}</td></tr>; })}</tbody></table></div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[12px] font-semibold text-slate-800">Applicable Charges</div><div className="text-[12px] text-slate-400">Rates and calculation basis come from Charge Master.</div></div>{!isLocked && <div className="flex gap-1.5"><SearchableSelect className="input min-w-[220px]" value={chargeToAdd} onChange={(e) => setChargeToAdd(e.target.value)}><option value="">— Select charge —</option>{chargeMaster.filter((master) => !charges.some((row) => row.charge_key === master.charge_key)).map((master) => <option key={master.id} value={master.charge_key}>{master.charge_name}</option>)}</SearchableSelect><button type="button" className="btn-secondary" onClick={addCharge}><Plus className="h-3.5 w-3.5" />Add</button></div>}</div>
        <div className="grid gap-2 p-3 md:grid-cols-2">{charges.length === 0 ? <div className="text-[12px] text-slate-400">No additional charges selected.</div> : charges.map((charge,index) => { const master=chargeMaster.find((row)=>row.charge_key===charge.charge_key); return <div key={charge.charge_key} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between"><strong className="text-[12px]">{master?.charge_name || charge.charge_key}</strong>{!isLocked && <button type="button" className="text-rose-600" onClick={() => setCharges((current) => current.filter((_,rowIndex)=>rowIndex!==index))}><Trash2 className="h-3.5 w-3.5" /></button>}</div><div className="grid grid-cols-2 gap-2"><div><label className="label">Qty / Basis</label><input className="input bg-slate-100 text-right" readOnly value={charge.quantity} /></div><div><label className="label">Rate</label><input className="input text-right" type="number" step="0.01" disabled={isLocked || Boolean(master?.is_fixed)} value={charge.rate} onChange={(e) => setCharges((current) => current.map((candidate,rowIndex) => rowIndex===index ? recalculateCharge(candidate,e.target.value) : candidate))} /></div><div><label className="label">Amount</label><input className="input bg-slate-100 text-right" readOnly value={charge.amount} /></div>{invoiceType === "Tax Invoice" && master?.tax_applicable && <div><label className="label">VAT %</label><input className="input bg-slate-100 text-right" readOnly value={charge.tax_percent} /></div>}</div></div>; })}</div>
      </section>

      <section className="ml-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-3 text-[12px]"><div className="mb-3"><label className="label">Discount / رعایت</label><input className="input text-right" type="number" min="0" step="0.01" disabled={isLocked} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} /><p className="mt-1 text-[11px] text-slate-400">Main Sales Invoice only.</p></div><div className="flex justify-between py-1"><span>Items Subtotal</span><strong>{formatCurrency(rowsSubtotal)}</strong></div>{invoiceType === "Tax Invoice" && <div className="flex justify-between py-1"><span>Item VAT</span><strong>{formatCurrency(itemTax)}</strong></div>}<div className="flex justify-between py-1"><span>Charges</span><strong>{formatCurrency(chargesSubtotal)}</strong></div>{invoiceType === "Tax Invoice" && <div className="flex justify-between py-1"><span>Charge VAT</span><strong>{formatCurrency(chargeTax)}</strong></div>}<div className="flex justify-between py-1 text-blue-700"><span>Linked Consolidated</span><strong>{formatCurrency(selectedHawalaTotal)}</strong></div><div className="flex justify-between py-1 text-rose-700"><span>Discount</span><strong>- {formatCurrency(discountValue)}</strong></div><div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm"><span className="font-semibold">Grand Total</span><strong>{formatCurrency(grandTotal)}</strong></div></section>

      <Modal open={previewOpen} title={`${invoiceType === "Tax Invoice" ? "With Tax" : "Without Tax"} Sales Invoice Preview — ${invoiceNo}`} onClose={() => setPreviewOpen(false)}>
        <div className="p-2">
          <PrintLayout
            voucherTitle={invoiceType === "Tax Invoice" ? "Tax Invoice" : "Sales Invoice"}
            voucherNo={invoiceNo}
            voucherDate={invoiceDate}
            company={{ name: companyPrint.company_name || "NAVILO", address: companyPrint.address || undefined, phone: companyPrint.phone || undefined, email: companyPrint.email || undefined, taxId: [companyPrint.ntn ? `NTN: ${companyPrint.ntn}` : "", companyPrint.strn ? `STRN: ${companyPrint.strn}` : ""].filter(Boolean).join(" | ") || undefined, logoUrl: companyPrint.logo_url || undefined }}
            party={{ name: selectedCustomer?.name || "—", address: selectedCustomer?.address, phone: selectedCustomer?.phone, email: selectedCustomer?.email, ntn: selectedCustomer?.ntn, strn: selectedCustomer?.strn, cnic: selectedCustomer?.cnic, taxRegistrationStatus: selectedCustomer?.tax_registration_status }}
            items={printItems}
            chargeBreakdown={printCharges}
            itemsTotal={rowsSubtotal}
            chargesTotal={chargesSubtotal}
            taxAmount={itemTax + chargeTax}
            showTaxSummary={invoiceType === "Tax Invoice"}
            normalInvoiceTotal={normalInvoiceTotal}
            hawalaDocuments={selectedHawalaInvoices.map((row) => ({ id: row.id, invoiceNo: row.invoice_no, invoiceDate: row.invoice_date, referenceName: row.reference_name, referenceNo: row.reference_no, referenceNotes: row.reference_notes, amount: Number(row.total) || 0 }))}
            grandTotal={grandTotal}
            extraFields={[{ label: "Sales Person / سیلز مین", value: salesPerson || "—" }, { label: "Reference", value: [referenceName, referenceNo].filter(Boolean).join(" · ") || "—" }, ...(discountValue > 0 ? [{ label: "Discount / رعایت", value: formatCurrency(discountValue) }] : [])]}
            documentHeader={companyPrint.document_header || undefined}
            documentHeaderUrdu={companyPrint.document_header_urdu || undefined}
            documentFooter={companyPrint.document_footer || undefined}
            documentFooterUrdu={companyPrint.document_footer_urdu || undefined}
            documentNotice="PAYMENT / SETTLEMENT IS RECORDED SEPARATELY"
            documentNoticeUrdu="ادائیگی اور وصولی الگ ریکارڈ کی جاتی ہے"
            signatureLabels={[companyPrint.prepared_by_label || "Prepared By", companyPrint.checked_by_label || "Checked By", companyPrint.approved_by_label || "Approved By"]}
          />
          <div className="mt-3 flex justify-end gap-2 border-t pt-3"><button type="button" className="btn-secondary" onClick={() => triggerPrint(".print-document")}><Printer className="h-3.5 w-3.5" />Print</button><button type="button" className="btn-primary" onClick={() => setPreviewOpen(false)}>Close</button></div>
        </div>
      </Modal>
    </div>
  );
}
