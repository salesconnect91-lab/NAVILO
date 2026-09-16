import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  Pencil,
  Printer,
  ReceiptText,
  ShieldCheck,
  Trash2,
  UserRound,
  WalletCards,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { SalesOrder, SalesOrderLine } from "@/types";
import {
  ConfirmModal,
  ErrorBanner,
  StatusBadge,
  formatCurrency,
  formatDate,
} from "@/components/ui";
import { exportToCSV, exportToExcel, triggerPrint } from "@/lib/exportUtils";
import type { ChargeBreakdownEntry } from "@/lib/chargeTypes";
import PrintLayout from "@/components/PrintLayout";
import InvoiceFinancialSummary from "./InvoiceFinancialSummary";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";
import { userFacingError } from "@/lib/errorMessage";
import DocumentTraceability from "@/components/DocumentTraceability";

type LinkedHawalaPrintRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  reference_name: string | null;
  reference_no: string | null;
  reference_notes: string | null;
  total: number | string;
};

type CustomerDetail = {
  id: string;
  name: string;
  name_urdu?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  ntn?: string | null;
  strn?: string | null;
  cnic?: string | null;
  tax_registration_status?: "registered" | "unregistered" | null;
};

type ItemDetail = {
  id?: string;
  name?: string | null;
  name_urdu?: string | null;
  sku?: string | null;
  hs_code?: string | null;
  unit?: string | null;
};

type PaymentStatus = "unpaid" | "partial" | "paid" | "overpaid";

type SalesInvoiceDetailOrder = Omit<SalesOrder, "customer"> & {
  customer?: CustomerDetail | null;
  due_date?: string | null;
  paid_amount?: number | string | null;
  outstanding_amount?: number | string | null;
  payment_status?: PaymentStatus | null;
  invoice_type?: "Sale Invoice" | "Tax Invoice";
  fbr_invoice_no?: string | null;
};

type SalesInvoiceLine = Omit<SalesOrderLine, "item"> & {
  item?: ItemDetail | null;
  description?: string | null;
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

type SalesPrintVisibility = {
  show_company_name: boolean;
  show_logo: boolean;
  show_address: boolean;
  show_phone_email: boolean;
  show_tax_details: boolean;
  show_header: boolean;
  show_footer: boolean;
  show_signatures: boolean;
  show_print_datetime: boolean;
  show_page_numbers: boolean;
};

type DynamicCharge = {
  id: string;
  charge_key: string;
  charge_label: string | null;
  amount: number | string | null;
  quantity?: number | string | null;
  rate?: number | string | null;
  tax_percent?: number | string | null;
};

type FinancialSnapshot = {
  previous_balance: number | string | null;
  paid_amount: number | string | null;
  outstanding_amount: number | string | null;
  today_received: number | string | null;
  last_payment_amount: number | string | null;
  last_payment_date: string | null;
  last_payment_mode: string | null;
};

const DEFAULT_VISIBILITY: SalesPrintVisibility = {
  show_company_name: true,
  show_logo: true,
  show_address: true,
  show_phone_email: true,
  show_tax_details: true,
  show_header: true,
  show_footer: true,
  show_signatures: true,
  show_print_datetime: false,
  show_page_numbers: true,
};

const n = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function paymentBadge(status?: string | null) {
  const normalized = (status || "unpaid").toLowerCase();
  const cls =
    normalized === "paid"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : normalized === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : normalized === "overpaid"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-rose-200 bg-rose-50 text-rose-700";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[12px] font-semibold capitalize ${cls}`}>
      {normalized}
    </span>
  );
}

export default function SalesInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeCompany, isPlatformOwner } = useAuth();
  const role = activeCompany?.membership_role;
  const permissions = activeCompany?.permissions;
  const canEdit = canPerformModule(role, "sales", "edit", permissions, isPlatformOwner);
  const canDelete = canPerformModule(role, "sales", "delete", permissions, isPlatformOwner);
  const canPost = canPerformModule(role, "sales", "post", permissions, isPlatformOwner);
  const canPrint = canPerformModule(role, "sales", "print", permissions, isPlatformOwner);

  const [order, setOrder] = useState<SalesInvoiceDetailOrder | null>(null);
  const [lines, setLines] = useState<SalesInvoiceLine[]>([]);
  const [charges, setCharges] = useState<DynamicCharge[]>([]);
  const [hawala, setHawala] = useState<LinkedHawalaPrintRow[]>([]);
  const [companyPrint, setCompanyPrint] = useState<CompanyPrintSettings>({});
  const [visibility, setVisibility] = useState<SalesPrintVisibility>(DEFAULT_VISIBILITY);
  const [financial, setFinancial] = useState<FinancialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [orderRes, linesRes, chargesRes, linksRes, companyRes, visibilityRes] = await Promise.all([
        supabase.from("sales_orders").select("*,customer:customers(*)").eq("id", id).maybeSingle(),
        supabase.from("sales_order_lines").select("*,item:items(*)").eq("order_id", id).order("created_at"),
        supabase.from("sales_order_charges").select("id,charge_key,charge_label,amount,quantity,rate,tax_percent").eq("order_id", id).order("created_at"),
        supabase.from("sales_order_hawala_invoices").select("hawala_invoice_id").eq("sales_order_id", id),
        supabase.from("company_settings").select("*").maybeSingle(),
        supabase.from("document_print_visibility").select("*").eq("document_type", "sales_invoice").maybeSingle(),
      ]);

      const firstError = orderRes.error || linesRes.error || chargesRes.error || linksRes.error || companyRes.error;
      if (firstError) throw firstError;

      setOrder((orderRes.data ?? null) as SalesInvoiceDetailOrder | null);
      setLines((linesRes.data ?? []) as SalesInvoiceLine[]);
      setCharges((chargesRes.data ?? []) as DynamicCharge[]);
      setCompanyPrint((companyRes.data || {}) as CompanyPrintSettings);
      if (!visibilityRes.error) setVisibility({ ...DEFAULT_VISIBILITY, ...(visibilityRes.data || {}) });

      const hawalaIds = (linksRes.data ?? []).map((row: { hawala_invoice_id: string }) => row.hawala_invoice_id);
      if (hawalaIds.length) {
        const { data, error: hawalaError } = await supabase
          .from("consolidated_sales_invoices")
          .select("id,invoice_no,invoice_date,reference_name,reference_no,reference_notes,total")
          .in("id", hawalaIds)
          .order("invoice_date")
          .order("invoice_no");
        if (hawalaError) throw hawalaError;
        setHawala((data ?? []) as LinkedHawalaPrintRow[]);
      } else {
        setHawala([]);
      }
    } catch (e) {
      setError(userFacingError(e, "Failed to load invoice."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isTaxInvoice = order?.invoice_type === "Tax Invoice";
  const locked = order?.status === "posted" || order?.status === "closed";
  const itemsTotal = useMemo(() => lines.reduce((sum, line) => sum + n(line.line_total), 0), [lines]);
  const chargeBreakdown = useMemo<ChargeBreakdownEntry[]>(
    () => charges.filter((charge) => n(charge.amount) > 0).map((charge) => ({ label: charge.charge_label || charge.charge_key, amount: n(charge.amount) })),
    [charges]
  );
  const chargesTotal = useMemo(() => chargeBreakdown.reduce((sum, charge) => sum + charge.amount, 0), [chargeBreakdown]);
  const itemTax = isTaxInvoice ? lines.reduce((sum, line) => sum + (n(line.line_total) * n(line.tax_percent)) / 100, 0) : 0;
  const chargeTax = isTaxInvoice ? charges.reduce((sum, charge) => sum + (n(charge.amount) * n(charge.tax_percent)) / 100, 0) : 0;
  const taxAmount = itemTax + chargeTax;
  const linkedHawalaTotal = useMemo(() => hawala.reduce((sum, row) => sum + n(row.total), 0), [hawala]);
  const normalInvoiceTotal = Math.max(n(order?.total) - linkedHawalaTotal, 0);
  const paidAmount = n(order?.paid_amount);
  const outstanding = n(order?.outstanding_amount);

  const handlePost = async () => {
    if (!order || locked || posting) return;
    if (!order.customer_id || !order.customer) {
      setError("Customer is required before posting the Main Sales Invoice.");
      return;
    }
    if (isTaxInvoice && order.customer.tax_registration_status === "registered" && !order.customer.strn && !order.customer.ntn) {
      setError("A registered customer must have an STRN or NTN saved in Customer Master before posting a Tax Invoice.");
      return;
    }
    if (!window.confirm("Post Main Sales Invoice? This will lock the stock and accounting history for this invoice.")) return;

    setPosting(true);
    setError(null);
    setPostSuccess(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("post_sales_invoice", { p_order_id: order.id });
      if (rpcError) throw rpcError;
      const result = data as { success?: boolean; error?: string | null; message?: string | null; journal_entry_no?: string | null } | null;
      if (!result?.success) throw new Error(result?.error || result?.message || "Failed to post sales invoice.");
      setPostSuccess(result.journal_entry_no ? `Invoice posted successfully — Journal ${result.journal_entry_no}.` : "Invoice posted successfully.");
      await load();
    } catch (e) {
      setError(userFacingError(e, "Failed to post sales invoice."));
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async () => {
    if (!order || locked) return;
    const { error: deleteError } = await supabase.from("sales_orders").delete().eq("id", order.id).eq("status", "draft");
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    navigate("/sales");
  };

  const handlePrint = () => {
    setShowPrint(true);
    window.setTimeout(() => {
      triggerPrint("#sales-invoice-print-root");
      window.setTimeout(() => setShowPrint(false), 250);
    }, 150);
  };

  const exportRows = lines.map((line) => ({
    item: line.item?.name ?? "—",
    description: line.description ?? "",
    hs_code: line.item?.hs_code ?? "",
    uom: line.item?.unit ?? "",
    grade: line.grade ?? "",
    size: line.size ?? "",
    qty: n(line.qty),
    rate: n(line.unit_price),
    vat_percent: isTaxInvoice ? n(line.tax_percent) : 0,
    vat_amount: isTaxInvoice ? (n(line.line_total) * n(line.tax_percent)) / 100 : 0,
    amount: n(line.line_total),
  }));

  const exportColumns = [
    { key: "item", label: "Item / آئٹم" },
    { key: "description", label: "Description / تفصیل" },
    { key: "hs_code", label: "HS Code" },
    { key: "uom", label: "UOM" },
    { key: "grade", label: "Grade / گریڈ" },
    { key: "size", label: "Size / سائز" },
    { key: "qty", label: "Qty" },
    { key: "rate", label: "Rate / ریٹ" },
    ...(isTaxInvoice ? [{ key: "vat_percent", label: "VAT %" }, { key: "vat_amount", label: "VAT Amount" }] : []),
    { key: "amount", label: "Amount / رقم" },
  ];

  if (loading) return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading invoice…</div>;
  if (!order) return <ErrorBanner message="Invoice not found." />;

  return (
    <div className="space-y-3">
      <section className="flex flex-col gap-3 border-b border-slate-200 pb-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <Link to="/sales" className="mb-1 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-blue-700">
            <ArrowLeft className="h-3 w-3" /> Sales Invoices
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <ReceiptText className="h-4 w-4 text-blue-600" />
            <h1 className="text-lg font-semibold text-slate-900">{order.order_no}</h1>
            <StatusBadge status={order.status} />
            {paymentBadge(order.payment_status)}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {isTaxInvoice ? "With Tax / Tax Invoice" : "Without Tax / Sale Invoice"} · {order.customer?.name || "No customer linked"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!locked && canPost && (
            <button type="button" className="btn-primary" disabled={posting} onClick={() => void handlePost()}>
              <ShieldCheck className="h-3.5 w-3.5" /> {posting ? "Posting…" : "Post Invoice / پوسٹ کریں"}
            </button>
          )}
          {!locked && canEdit && (
            <button type="button" className="btn-secondary" onClick={() => navigate(`/sales/${order.id}/edit`)}>
              <Pencil className="h-3.5 w-3.5" /> Edit / ترمیم
            </button>
          )}
          {canPrint && (
            <button type="button" className="btn-secondary" onClick={() => exportToCSV(`sales-invoice-${order.order_no}.csv`, exportColumns, exportRows)}>
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          )}
          {canPrint && (
            <button type="button" className="btn-secondary" onClick={() => exportToExcel(`sales-invoice-${order.order_no}.xlsx`, exportColumns, exportRows)}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
          )}
          {canPrint && (
            <button type="button" className="btn-secondary" onClick={handlePrint} data-direct-print>
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </button>
          )}
          {!locked && canDelete && (
            <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete / حذف کریں
            </button>
          )}
        </div>
      </section>

      {postSuccess && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{postSuccess}</div>}
      {error && <ErrorBanner message={error} />}
      {locked && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          <LockKeyhole className="h-3.5 w-3.5" /> Posted history is locked. Corrections must use reversal/return workflows.
        </div>
      )}

      <InvoiceFinancialSummary invoiceId={order.id} customerId={order.customer_id} onFinancialChange={setFinancial} />
      <DocumentTraceability documentType="sales_invoice" documentId={order.id} />

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-6">
        <Metric icon={<CalendarDays className="h-3 w-3" />} label="Invoice Date" value={formatDate(order.order_date)} />
        <Metric icon={<CalendarDays className="h-3 w-3" />} label="Due Date" value={order.due_date ? formatDate(order.due_date) : "—"} />
        <Metric icon={<UserRound className="h-3 w-3" />} label="Sales Person" value={order.sales_person || "—"} />
        <Metric label="Invoice Total" value={formatCurrency(n(order.total))} strong />
        <Metric icon={<Banknote className="h-3 w-3" />} label="Received" value={formatCurrency(paidAmount)} tone="emerald" strong />
        <Metric icon={<WalletCards className="h-3 w-3" />} label="Balance Due" value={formatCurrency(outstanding)} tone="rose" strong />
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
              <div><div className="text-[12px] font-semibold text-slate-800">Invoice Lines / بل کی تفصیل</div><div className="text-[11px] text-slate-400">{lines.length} line{lines.length === 1 ? "" : "s"}</div></div>
              <div className="text-right"><div className="text-[11px] uppercase text-slate-400">Items Total</div><div className="text-[12px] font-semibold">{formatCurrency(itemsTotal)}</div></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[12px]">
                <thead className="bg-slate-50"><tr className="border-b border-slate-200 uppercase tracking-wide text-slate-500"><th className="px-3 py-2 text-left">Item</th><th className="px-2 py-2 text-left">Description</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Rate</th>{isTaxInvoice && <th className="px-2 py-2 text-right">VAT</th>}<th className="px-3 py-2 text-right">Amount</th></tr></thead>
                <tbody>
                  {lines.map((line) => <tr key={line.id} className="border-b border-slate-100"><td className="px-3 py-2 font-semibold">{line.item?.name || "—"}</td><td className="px-2 py-2 text-slate-500">{line.description || "—"}</td><td className="px-2 py-2 text-right">{line.qty}</td><td className="px-2 py-2 text-right">{formatCurrency(n(line.unit_price))}</td>{isTaxInvoice && <td className="px-2 py-2 text-right">{n(line.tax_percent)}%<div className="text-[10px] text-slate-400">{formatCurrency((n(line.line_total) * n(line.tax_percent)) / 100)}</div></td>}<td className="px-3 py-2 text-right font-semibold">{formatCurrency(n(line.line_total))}</td></tr>)}
                  {!lines.length && <tr><td colSpan={isTaxInvoice ? 6 : 5} className="px-3 py-8 text-center text-slate-400">No invoice items.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2.5"><div className="text-[12px] font-semibold">Dynamic Charges / چارجز</div><div className="text-[11px] text-slate-400">Canonical rows from Charge Master</div></div>
            {!charges.length ? <div className="p-4 text-[12px] text-slate-400">No additional charges.</div> : <div className="divide-y divide-slate-100">{charges.map((charge) => <div key={charge.id} className="flex items-center justify-between gap-3 px-3 py-2.5"><div><div className="text-[12px] font-semibold">{charge.charge_label || charge.charge_key}</div><div className="text-[11px] text-slate-400">Qty {n(charge.quantity) || 1} · Rate {formatCurrency(n(charge.rate))}{isTaxInvoice && n(charge.tax_percent) > 0 ? ` · VAT ${n(charge.tax_percent)}%` : ""}</div></div><div className="font-semibold">{formatCurrency(n(charge.amount))}</div></div>)}</div>}
          </div>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-[72px] xl:self-start">
          {hawala.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-blue-200 bg-white">
              <div className="border-b border-blue-100 bg-blue-50 px-3 py-2.5"><div className="text-[12px] font-semibold text-blue-900">Linked Consolidated / Hawala</div><div className="text-[11px] text-blue-600">Stock was already issued there; it is not issued twice here.</div></div>
              <div className="divide-y divide-slate-100">{hawala.map((row) => <div key={row.id} className="p-3"><div className="flex justify-between gap-3"><div><div className="text-[12px] font-semibold">{row.invoice_no}</div><div className="text-[11px] text-slate-400">{formatDate(row.invoice_date)} · {row.reference_name || "—"}</div></div><div className="font-semibold text-blue-700">{formatCurrency(n(row.total))}</div></div></div>)}</div>
              <div className="flex justify-between border-t border-blue-100 bg-blue-50 px-3 py-2.5 text-[12px] font-semibold text-blue-900"><span>Linked Total</span><span>{formatCurrency(linkedHawalaTotal)}</span></div>
            </section>
          )}

          <section className="rounded-lg border border-slate-200 bg-white p-3 text-[12px]">
            <div className="mb-2 font-semibold">Invoice Summary / خلاصہ</div>
            <SummaryRow label="Items Total" value={itemsTotal} />
            <SummaryRow label="Charges Total" value={chargesTotal} />
            {isTaxInvoice && <SummaryRow label="VAT" value={taxAmount} />}
            {hawala.length > 0 && <><SummaryRow label="Main Invoice Total" value={normalInvoiceTotal} /><SummaryRow label="Linked Consolidated" value={linkedHawalaTotal} accent /></>}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><span>Grand Total</span><span>{formatCurrency(n(order.total))}</span></div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 text-[12px]">
            <div className="mb-2 font-semibold">Collection Position / وصولی</div>
            <div className="flex justify-between py-1"><span className="text-slate-500">Payment Status</span>{paymentBadge(order.payment_status)}</div>
            <div className="flex justify-between py-1"><span className="text-slate-500">Received</span><strong className="text-emerald-700">{formatCurrency(paidAmount)}</strong></div>
            <div className="flex justify-between py-1"><span className="text-slate-500">Balance Due</span><strong className="text-rose-700">{formatCurrency(outstanding)}</strong></div>
          </section>
        </aside>
      </section>

      <ConfirmModal open={confirmDelete} title="Delete Invoice / انوائس حذف کریں" message="Delete this draft sales invoice permanently?" onConfirm={() => void handleDelete()} onCancel={() => setConfirmDelete(false)} />

      {showPrint && (
        <div id="sales-invoice-print-root" data-print-root className="hidden print:block">
          <PrintLayout
            voucherTitle={isTaxInvoice ? "Tax Invoice" : "Sales Invoice"}
            voucherNo={order.order_no}
            voucherDate={order.order_date}
            company={{
              name: companyPrint.company_name || "NAVILO",
              address: companyPrint.address || undefined,
              phone: companyPrint.phone || undefined,
              email: companyPrint.email || undefined,
              taxId: [companyPrint.ntn ? `NTN: ${companyPrint.ntn}` : "", companyPrint.strn ? `STRN: ${companyPrint.strn}` : ""].filter(Boolean).join(" | ") || undefined,
              logoUrl: companyPrint.logo_url || undefined,
            }}
            party={{
              name: order.customer?.name || "—",
              address: order.customer?.address,
              phone: order.customer?.phone,
              email: order.customer?.email,
              ntn: order.customer?.ntn,
              strn: order.customer?.strn,
              cnic: order.customer?.cnic,
              taxRegistrationStatus: order.customer?.tax_registration_status,
            }}
            items={lines.map((line) => ({
              name: line.item?.name || "—",
              description: line.description,
              qty: n(line.qty),
              unitPrice: n(line.unit_price),
              lineTotal: n(line.line_total),
              taxPercent: isTaxInvoice ? n(line.tax_percent) : 0,
              taxAmount: isTaxInvoice ? (n(line.line_total) * n(line.tax_percent)) / 100 : 0,
              hsCode: line.item?.hs_code,
              unit: line.item?.unit,
            }))}
            chargeBreakdown={chargeBreakdown}
            itemsTotal={itemsTotal}
            chargesTotal={chargesTotal}
            taxAmount={taxAmount}
            showTaxSummary={isTaxInvoice}
            grandTotal={n(order.total)}
            hawalaDocuments={hawala.map((row) => ({ id: row.id, invoiceNo: row.invoice_no, invoiceDate: row.invoice_date, referenceName: row.reference_name, referenceNo: row.reference_no, referenceNotes: row.reference_notes, amount: n(row.total) }))}
            normalInvoiceTotal={normalInvoiceTotal}
            paymentSummary={financial ? {
              previousBalance: n(financial.previous_balance),
              totalReceived: n(financial.paid_amount),
              todayReceived: n(financial.today_received),
              lastPaymentAmount: n(financial.last_payment_amount),
              lastPaymentDate: financial.last_payment_date,
              lastPaymentMode: financial.last_payment_mode,
              currentOutstanding: n(financial.outstanding_amount),
            } : undefined}
            extraFields={[
              { label: "Status / حیثیت", value: String(order.status).toUpperCase() },
              { label: "Settlement / ادائیگی", value: "Receipts recorded separately" },
              ...(order.sales_person ? [{ label: "Sales Person / سیلز مین", value: order.sales_person }] : []),
              ...(order.fbr_invoice_no ? [{ label: "FBR Invoice No.", value: order.fbr_invoice_no }] : []),
            ]}
            signatureLabels={[
              companyPrint.prepared_by_label || "Prepared By / تیار کردہ",
              companyPrint.checked_by_label || "Checked By / جانچ کردہ",
              companyPrint.approved_by_label || "Approved By / منظور کردہ",
            ]}
            visibility={{
              showCompanyName: visibility.show_company_name,
              showLogo: visibility.show_logo,
              showAddress: visibility.show_address,
              showPhoneEmail: visibility.show_phone_email,
              showTaxDetails: visibility.show_tax_details,
              showHeader: visibility.show_header,
              showFooter: visibility.show_footer,
              showSignatures: visibility.show_signatures,
              showPrintDatetime: visibility.show_print_datetime,
              showPageNumbers: visibility.show_page_numbers,
            }}
            documentHeader={companyPrint.document_header}
            documentHeaderUrdu={companyPrint.document_header_urdu}
            documentFooter={companyPrint.document_footer}
            documentFooterUrdu={companyPrint.document_footer_urdu}
          />
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, strong = false, tone }: { icon?: React.ReactNode; label: string; value: string; strong?: boolean; tone?: "emerald" | "rose" }) {
  const toneClass = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-800";
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{icon}{label}</div><div className={`mt-1.5 ${strong ? "text-[15px] font-semibold" : "text-[12px] font-semibold"} ${toneClass}`}>{value}</div></div>;
}

function SummaryRow({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div className={`flex justify-between py-1 ${accent ? "text-blue-700" : "text-slate-500"}`}><span>{label}</span><span className="font-semibold">{formatCurrency(value)}</span></div>;
}
