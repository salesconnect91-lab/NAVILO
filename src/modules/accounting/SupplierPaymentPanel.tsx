import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import jsPDF from "jspdf";
import {
  documentContactText,
  documentOrientation,
  documentPageFormat,
  documentTaxText,
  loadDocumentPrintSettings,
} from "@/lib/documentPrintSettings";

type Supplier = { id: string; name: string };
type PurchaseOrder = {
  id: string; order_no: string; order_date: string; supplier_id: string | null;
  total: number; paid_amount: number; outstanding_amount: number; payment_status: string; status: string;
};
type Account = { id: string; code: string; name: string };
type SupplierPaymentReceipt = {
  entry_no: string; supplier_name: string; invoice_no: string; date: string;
  payment_method: string; account: string; amount: number; balance_before?: number; balance_after?: number;
};

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

export default function SupplierPaymentPanel() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastPaymentReceipt, setLastPaymentReceipt] = useState<SupplierPaymentReceipt | null>(null);

  const loadData = async () => {
    setLoading(true); setError(null);
    const [supplierResult, orderResult, accountResult] = await Promise.all([
      supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
      supabase.from("purchase_orders").select("id,order_no,order_date,supplier_id,total,paid_amount,outstanding_amount,payment_status,status").eq("status", "posted").gt("outstanding_amount", 0).neq("payment_status", "paid").order("order_date", { ascending: true }),
      supabase.from("chart_of_accounts").select("id,code,name").eq("is_active", true).eq("is_group", false).eq("allow_manual_entries", true).in("detail_type", ["Cash on Hand", "Bank Account"]).order("code"),
    ]);
    if (supplierResult.error) setError(supplierResult.error.message); else setSuppliers((supplierResult.data ?? []) as Supplier[]);
    if (orderResult.error) setError(orderResult.error.message); else setOrders((orderResult.data ?? []).map((row: any) => ({ ...row, total: Number(row.total || 0), paid_amount: Number(row.paid_amount || 0), outstanding_amount: Number(row.outstanding_amount || 0) })) as PurchaseOrder[]);
    if (accountResult.error) setError(accountResult.error.message); else {
      const loaded = (accountResult.data ?? []) as Account[]; setAccounts(loaded);
      if (!accountId && loaded.length) {
        const preferred = loaded.find((a) => `${a.code} ${a.name}`.toLowerCase().includes("cash")) ?? loaded[0];
        setAccountId(preferred.id);
      }
    }
    setLoading(false);
  };

  useEffect(() => { void loadData(); }, []);
  const supplierOrders = useMemo(() => orders.filter((order) => order.supplier_id === supplierId && order.outstanding_amount > 0), [orders, supplierId]);
  const selectedOrder = supplierOrders.find((order) => order.id === orderId) ?? null;
  const amountNumber = Number(amount || 0);
  const selectOrder = (id: string) => { setOrderId(id); const order = supplierOrders.find((item) => item.id === id); setAmount(order ? order.outstanding_amount.toFixed(2) : ""); };

  const printPaymentReceipt = async (receipt: SupplierPaymentReceipt) => {
    try {
      const { company, visibility } = await loadDocumentPrintSettings("receipt_payment");
      const popup = window.open("", "_blank", "width=900,height=1000");
      if (!popup) { setError("Please allow pop-ups to print the supplier payment."); return; }
      const companyName = company.company_name || "NAVILO";
      const contact = documentContactText(company);
      const tax = documentTaxText(company);
      const size = documentPageFormat(company.page_size) === "letter" ? "Letter" : "A4";
      const orientation = documentOrientation(company.page_orientation);
      popup.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Supplier Payment ${receipt.entry_no}</title><style>*{box-sizing:border-box}body{margin:0;padding:30px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:13px}.sheet{max-width:800px;margin:auto;background:white;padding:42px;border:1px solid #e5e7eb}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111827;padding-bottom:20px}.brand{font-size:26px;font-weight:800}.logo{max-height:65px;max-width:180px;object-fit:contain;margin-bottom:8px}.muted{color:#6b7280;margin-top:5px}.title{font-size:22px;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:28px 0}.label{color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase}.value{margin-top:5px;font-size:14px;font-weight:700}.amount{margin:24px 0;padding:18px 20px;border:1px solid #d1d5db;background:#f9fafb;display:flex;justify-content:space-between}.amount strong{font-size:25px}.signature{width:180px;border-top:1px solid #9ca3af;text-align:center;padding-top:8px;color:#6b7280;font-size:12px}.signatures{margin-top:55px;display:flex;justify-content:flex-end}.footer{margin-top:30px}.meta{margin-top:25px;font-size:12px;color:#94a3b8;display:flex;justify-content:space-between}@media print{body{padding:0;background:white}.sheet{border:0;max-width:none}@page{size:${size} ${orientation};margin:10mm}}</style></head><body><div class="sheet"><div class="top"><div>${visibility.show_logo && company.logo_url ? `<img class="logo" src="${company.logo_url}" alt="Company Logo"/>` : ""}${visibility.show_company_name ? `<div class="brand">${companyName}</div>` : ""}${visibility.show_address && company.address ? `<div class="muted">${company.address}</div>` : ""}${visibility.show_phone_email && contact ? `<div class="muted">${contact}</div>` : ""}${visibility.show_tax_details && tax ? `<div class="muted">${tax}</div>` : ""}</div><div style="text-align:right"><div class="title">Payment</div><div class="muted">${receipt.entry_no}</div></div></div>${visibility.show_header && company.document_header ? `<div class="footer">${company.document_header}</div>` : ""}<div class="grid"><div><div class="label">Paid To</div><div class="value">${receipt.supplier_name}</div></div><div><div class="label">Payment Date</div><div class="value">${receipt.date}</div></div><div><div class="label">Purchase Invoice</div><div class="value">${receipt.invoice_no}</div></div><div><div class="label">Payment Method</div><div class="value">${receipt.payment_method}</div></div><div><div class="label">Payment Account</div><div class="value">${receipt.account}</div></div></div>${visibility.show_previous_balance ? `<div class="amount"><span>Previous Balance</span><strong>Rs. ${money(receipt.balance_before ?? 0)}</strong></div>` : ""}<div class="amount"><span>Total Amount Paid</span><strong>Rs. ${money(receipt.amount)}</strong></div>${visibility.show_closing_balance ? `<div class="amount"><span>Closing Balance</span><strong>Rs. ${money(receipt.balance_after ?? 0)}</strong></div>` : ""}${visibility.show_signatures ? `<div class="signatures"><div class="signature">${company.approved_by_label || "Authorized Signature"}</div></div>` : ""}${visibility.show_footer && company.document_footer ? `<div class="footer muted">${company.document_footer}</div>` : ""}${visibility.show_print_datetime || visibility.show_page_numbers ? `<div class="meta"><span>${visibility.show_print_datetime ? `Printed: ${new Date().toLocaleString("en-PK")}` : ""}</span><span>${visibility.show_page_numbers ? "Page 1" : ""}</span></div>` : ""}</div><script>window.onload=function(){window.focus();setTimeout(function(){window.print()},300)}</script></body></html>`);
      popup.document.close();
    } catch (err: any) { setError(err?.message || "Failed to load payment print settings."); }
  };

  const downloadPaymentPdf = async (receipt: SupplierPaymentReceipt) => {
    try {
      const { company, visibility } = await loadDocumentPrintSettings("receipt_payment");
      const pdf = new jsPDF({ orientation: documentOrientation(company.page_orientation), unit: "mm", format: documentPageFormat(company.page_size) });
      const pageWidth = pdf.internal.pageSize.getWidth(); const pageHeight = pdf.internal.pageSize.getHeight(); const margin = 16; let y = 18;
      if (visibility.show_company_name) { pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.text(company.company_name || "NAVILO", margin, y); y += 7; }
      if (visibility.show_address && company.address) { pdf.setFontSize(9); pdf.setFont("helvetica", "normal"); pdf.text(company.address, margin, y); y += 5; }
      const contact = documentContactText(company); if (visibility.show_phone_email && contact) { pdf.setFontSize(8); pdf.text(contact, margin, y); y += 5; }
      const tax = documentTaxText(company); if (visibility.show_tax_details && tax) { pdf.setFontSize(8); pdf.text(tax, margin, y); y += 5; }
      if (visibility.show_header && company.document_header) { y += 2; pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.text(company.document_header, margin, y); y += 7; }
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.text("SUPPLIER PAYMENT VOUCHER", margin, y); pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.text(receipt.entry_no, pageWidth - margin, y, { align: "right" }); y += 10; pdf.line(margin, y, pageWidth - margin, y); y += 10;
      [["Supplier", receipt.supplier_name], ["Purchase Invoice", receipt.invoice_no], ["Payment Date", receipt.date], ["Payment Method", receipt.payment_method], ["Payment Account", receipt.account]].forEach(([label, value]) => { pdf.setFont("helvetica", "bold"); pdf.text(label, margin, y); pdf.setFont("helvetica", "normal"); pdf.text(String(value), margin + 45, y); y += 8; });
      y += 4; pdf.setFont("helvetica", "bold"); pdf.setFontSize(12);
      if (visibility.show_previous_balance) { pdf.setFontSize(10); pdf.text("Previous Balance", margin, y); pdf.text(`Rs. ${money(receipt.balance_before ?? 0)}`, pageWidth - margin, y, { align: "right" }); y += 8; }
      pdf.text("Total Amount Paid", margin, y); pdf.text(`Rs. ${money(receipt.amount)}`, pageWidth - margin, y, { align: "right" });
      if (visibility.show_closing_balance) { y += 8; pdf.setFontSize(10); pdf.text("Closing Balance", margin, y); pdf.text(`Rs. ${money(receipt.balance_after ?? 0)}`, pageWidth - margin, y, { align: "right" }); }
      if (visibility.show_signatures) { y += 22; pdf.line(pageWidth - margin - 55, y, pageWidth - margin, y); pdf.setFontSize(8); pdf.text(company.approved_by_label || "Authorized Signature", pageWidth - margin - 27.5, y + 5, { align: "center" }); }
      if (visibility.show_footer && company.document_footer) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text(company.document_footer, margin, pageHeight - 15); }
      if (visibility.show_print_datetime) { pdf.setFontSize(7); pdf.text(`Printed: ${new Date().toLocaleString("en-PK")}`, margin, pageHeight - 8); }
      if (visibility.show_page_numbers) { pdf.setFontSize(7); pdf.text("Page 1", pageWidth - margin, pageHeight - 8, { align: "right" }); }
      pdf.save(`${receipt.entry_no}-Supplier-Payment.pdf`);
    } catch (err: any) { setError(err?.message || "Failed to generate supplier payment PDF."); }
  };

  const handlePost = async () => {
    setError(null); setSuccess(null);
    if (!supplierId) return setError("Select supplier");
    if (!selectedOrder) return setError("Select open purchase invoice");
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return setError("Enter valid payment amount");
    if (amountNumber > selectedOrder.outstanding_amount + 0.005) return setError("Payment cannot exceed outstanding balance.");
    if (!accountId) return setError("Select Payment Account.");
    setSaving(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("pay_supplier", { p_supplier_id: supplierId, p_payment_date: paymentDate, p_payment_account_id: accountId, p_payment_method: paymentMethod, p_reference: reference.trim() || null, p_description: `Payment against ${selectedOrder.order_no}`, p_notes: notes.trim() || null, p_purchase_order_id: selectedOrder.id, p_amount: amountNumber });
      if (rpcError) throw rpcError;
      const result = (data ?? {}) as { entry_no?: string; journal_entry_id?: string; payment_amount?: number };
      setSuccess(`Supplier payment posted successfully${result.entry_no ? ` — ${result.entry_no}` : ""}. Rs. ${money(result.payment_amount ?? amountNumber)}`);
      const selectedAccount = accounts.find((account) => account.id === accountId); const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
      let supplierBalanceSnapshot: { balance_before: number | null; payment_amount: number | null; balance_after: number | null } | null = null;
      if (result.journal_entry_id) { const { data: snapshotData, error: snapshotError } = await supabase.from("journal_entries").select("balance_before,payment_amount,balance_after").eq("id", result.journal_entry_id).maybeSingle(); if (snapshotError) throw snapshotError; supplierBalanceSnapshot = snapshotData; }
      setLastPaymentReceipt({ entry_no: result.entry_no || "Supplier Payment", supplier_name: selectedSupplier?.name || "Supplier", invoice_no: selectedOrder.order_no, date: paymentDate, payment_method: paymentMethod, account: selectedAccount?.name || "—", amount: result.payment_amount ?? amountNumber, balance_before: Number(supplierBalanceSnapshot?.balance_before ?? 0), balance_after: Number(supplierBalanceSnapshot?.balance_after ?? 0) });
      setOrderId(""); setAmount(""); setReference(""); setNotes(""); await loadData();
    } catch (err: any) { setError(err?.message || err?.details || err?.hint || "Failed to post supplier payment."); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex min-h-[250px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>Loading supplier payments...</div>;

  return <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold text-slate-900">New Supplier Payment</h2><p className="mt-0.5 text-xs text-slate-500">Supplier → Purchase Invoice → Payment Account → Pay & Post</p></div><button type="button" onClick={() => void loadData()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><RefreshCw className="h-4 w-4"/>Refresh</button></div>
    <div className="space-y-5 p-5">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{success}</div>}
      {lastPaymentReceipt && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="mr-2 text-xs font-bold text-slate-500">Payment Tools</span><button type="button" onClick={() => printPaymentReceipt(lastPaymentReceipt)} className="btn-secondary text-sm">Print</button><button type="button" onClick={() => downloadPaymentPdf(lastPaymentReceipt)} className="btn-secondary text-sm">PDF</button></div>}
      <div className="grid gap-4 md:grid-cols-3">
        <div><label className="mb-1.5 block text-xs font-semibold">Payment Date</label><input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3"/></div>
        <div><label className="mb-1.5 block text-xs font-semibold">Payment Method</label><SearchableSelect value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3"><option value="Cash">Cash</option><option value="Bank">Bank</option><option value="Cheque">Cheque</option><option value="Online">Online</option><option value="Other">Other</option></SearchableSelect></div>
        <div><label className="mb-1.5 block text-xs font-semibold">Payment Account</label><SearchableSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3"><option value="">Select payment account</option>{accounts.map((account) => <option key={account.id} value={account.id} data-search={account.code}>{account.name}</option>)}</SearchableSelect></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold">Supplier</label><SearchableSelect value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setOrderId(""); setAmount(""); setSuccess(null); }} className="h-10 w-full rounded-lg border border-slate-200 px-3"><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</SearchableSelect></div><div><label className="mb-1.5 block text-xs font-semibold">Open Purchase Invoice</label><SearchableSelect value={orderId} disabled={!supplierId} onChange={(e) => selectOrder(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 disabled:bg-slate-50"><option value="">Select open invoice</option>{supplierOrders.map((order) => <option key={order.id} value={order.id}>{order.order_no} — Outstanding Rs. {money(order.outstanding_amount)}</option>)}</SearchableSelect></div></div>
      {selectedOrder && <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"><div><div className="text-xs text-slate-500">Invoice Total</div><div className="font-bold">Rs. {money(selectedOrder.total)}</div></div><div><div className="text-xs text-slate-500">Paid</div><div className="font-bold">Rs. {money(selectedOrder.paid_amount)}</div></div><div><div className="text-xs text-slate-500">Outstanding</div><div className="font-bold text-amber-700">Rs. {money(selectedOrder.outstanding_amount)}</div></div></div>}
      <div className="grid gap-4 md:grid-cols-3"><div><label className="mb-1.5 block text-xs font-semibold">Amount Paid</label><input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3" placeholder="0.00"/></div><div><label className="mb-1.5 block text-xs font-semibold">Reference</label><input value={reference} onChange={(e) => setReference(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3" placeholder="Optional"/></div><div><label className="mb-1.5 block text-xs font-semibold">Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3" placeholder="Optional"/></div></div>
      <div className="flex justify-end border-t border-slate-200 pt-4"><button type="button" disabled={saving || !supplierId || !selectedOrder || !accountId || amountNumber <= 0} onClick={() => void handlePost()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? <><Loader2 className="h-4 w-4 animate-spin"/>Posting...</> : <><CheckCircle2 className="h-4 w-4"/>Pay & Post</>}</button></div>
    </div>
  </section>;
}
