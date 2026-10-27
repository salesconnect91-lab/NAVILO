import {fetchAllPages} from "@/lib/fetchAllPages";
import {currentCurrency} from "@/components/ui";
import { escapePrintHtml, createPrintDocument } from "@/lib/printDocument";
import {useAuth} from "@/auth/AuthContext";
import TransportCashSettlement from "./TransportCashSettlement";
import NaviloDateInput from '@/components/NaviloDateInput';
import SearchableSelect from "@/components/SearchableSelect";
import QuickMasterAdd from "@/components/QuickMasterAdd";
import { useEffect, useMemo, useRef, useState } from "react";
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
  payment_method: string; account: string; amount: number; balance_before?: number | null; balance_after?: number | null;
};

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const balanceDisplay = (value: number | null | undefined) => value == null ? "Not available" : `${currentCurrency()} ${money(value)}`;
const money = (value: number) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

export default function SupplierPaymentPanel({initialTransport=false}:{initialTransport?:boolean}) {
  const {activeBusinessUnit}=useAuth();
  const [transportMode,setTransportMode]=useState(initialTransport);
  useEffect(()=>setTransportMode(initialTransport),[initialTransport]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [invoiceLoading,setInvoiceLoading] = useState(false);
  const [invoiceReload,setInvoiceReload] = useState(0);
  const invoiceRequest = useRef(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [invoiceAllocations, setInvoiceAllocations] = useState<Record<string,string>>({});
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const postingRef = useRef(false);
  const paymentRequestRef = useRef<{ id: string; payload: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastPaymentReceipt, setLastPaymentReceipt] = useState<SupplierPaymentReceipt | null>(null);

  const loadData = async (quiet=false) => {
    if(!quiet)setLoading(true); setError(null);
    const [supplierResult, accountResult] = await Promise.all([
      supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
      supabase.from("chart_of_accounts").select("id,code,name").eq("is_active", true).eq("is_group", false).eq("allow_manual_entries", true).in("detail_type", ["Cash on Hand", "Bank Account"]).order("code"),
    ]);
    if (supplierResult.error) setError(supplierResult.error.message); else setSuppliers((supplierResult.data ?? []) as Supplier[]);
    if (accountResult.error) setError(accountResult.error.message); else {
      const loaded = (accountResult.data ?? []) as Account[]; setAccounts(loaded);
      if (!accountId && loaded.length) {
        const preferred = loaded.find((a) => `${a.code} ${a.name}`.toLowerCase().includes("cash")) ?? loaded[0];
        setAccountId(preferred.id);
      }
    }
    setLoading(false);
  };

  useEffect(()=>{
    const token=++invoiceRequest.current;
    setOrders([]);
    if(!supplierId){setInvoiceLoading(false);return;}
    setInvoiceLoading(true);
    let cancelled=false;
    const getInvoices=async()=>{
      const data=await fetchAllPages<PurchaseOrder>((from,to)=>supabase.from("purchase_orders")
        .select("id,order_no,order_date,supplier_id,total,paid_amount,outstanding_amount,payment_status,status")
        .eq("supplier_id",supplierId).eq("status","posted")
        .gt("outstanding_amount",0).neq("payment_status","paid")
        .order("order_date",{ascending:true}).order("id",{ascending:true}).range(from,to));
      if(cancelled||token!==invoiceRequest.current)return;
      setOrders(data.map(row=>({...row,total:Number(row.total||0),paid_amount:Number(row.paid_amount||0),outstanding_amount:Number(row.outstanding_amount||0)})));
      setInvoiceLoading(false);
    };
    void getInvoices().catch(e=>{if(!cancelled&&token===invoiceRequest.current){setError(e?.message||"Unable to load supplier invoices");setInvoiceLoading(false);}});
    return()=>{cancelled=true;};
  },[supplierId,invoiceReload]);

  const refreshPaymentAccounts=async()=>{
    const r=await supabase.from("chart_of_accounts").select("id,code,name")
      .eq("is_active",true).eq("is_group",false).eq("allow_manual_entries",true)
      .in("detail_type",["Cash on Hand","Bank Account"]).order("code");
    if(r.error)throw r.error;setAccounts((r.data||[]) as Account[]);
  };
  const createdSupplier=async(record:{id:string;name:string})=>{
    setSuppliers(v=>v.some(s=>s.id===record.id)?v:[...v,record]);
    setSupplierId(record.id);setOrderId("");setInvoiceAllocations({});setAmount("");setSuccess(null);
  };
  useEffect(() => { void loadData(); }, []);
  const supplierOrders = useMemo(() => orders.filter((order) => order.supplier_id === supplierId && order.outstanding_amount > 0).sort((a,b)=>(a.payment_status==="partial"?0:1)-(b.payment_status==="partial"?0:1)), [orders, supplierId]);
  const selectedOrder = supplierOrders.find((order) => order.id === orderId) ?? null;
  const amountNumber = Number(amount || 0);
  const selectedInvoices = supplierOrders.filter(o => Object.prototype.hasOwnProperty.call(invoiceAllocations,o.id));
  const allocatedTotal = selectedInvoices.reduce((sum,o)=>sum+Number(invoiceAllocations[o.id]||0),0);
  const multi = selectedInvoices.length > 1;
  const allocationValid = selectedInvoices.every(o => Number(invoiceAllocations[o.id])>0 && Number(invoiceAllocations[o.id])<=o.outstanding_amount+0.005);
  const selectOrder = (id: string) => {
    setOrderId("");
    if (!id || Object.prototype.hasOwnProperty.call(invoiceAllocations,id)) return;
    const order = supplierOrders.find(item=>item.id===id);
    if (!order) return;
    const remaining = Math.max(0, amountNumber-allocatedTotal);
    if (remaining < 0.005) { setError("Amount Paid is fully allocated. Increase it or edit/remove an allocation."); return; }
    const value = Math.min(order.outstanding_amount,remaining);
    setInvoiceAllocations(prev=>({...prev,[id]:String(Number(value.toFixed(2)))}));
  };

  const autoAllocate = () => {
    if(!(amountNumber>0)) {setError("Enter Amount Paid first.");return;}
    let remaining=amountNumber;
    const next:Record<string,string>={};
    for(const invoice of [...supplierOrders].sort((a,b)=>a.order_date.localeCompare(b.order_date))){
      if(remaining<0.005)break;
      const allocated=Math.min(invoice.outstanding_amount,remaining);
      if(allocated>=0.005){next[invoice.id]=String(Number(allocated.toFixed(2)));remaining=Number((remaining-allocated).toFixed(2));}
    }
    setInvoiceAllocations(next);
    setError(remaining>=0.005?"Open invoice balances are insufficient for the entered payment.":"");
  };

  const printPaymentReceipt = async (receipt: SupplierPaymentReceipt) => {
    try {
      const { company, visibility } = await loadDocumentPrintSettings("receipt_payment");
      const popup = createPrintDocument();
      if (!popup) { setError("Please allow pop-ups to print the supplier payment."); return; }
      const companyName = company.company_name || "NAVILO";
      const contact = documentContactText(company);
      const tax = documentTaxText(company);
      const size = documentPageFormat(company.page_size) === "letter" ? "Letter" : "A4";
      const orientation = documentOrientation(company.page_orientation);
      popup.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Supplier Payment ${escapePrintHtml(receipt.entry_no)}</title><style>*{box-sizing:border-box}body{margin:0;padding:30px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:13px}.sheet{max-width:800px;margin:auto;background:white;padding:42px;border:1px solid #e5e7eb}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111827;padding-bottom:20px}.brand{font-size:26px;font-weight:800}.logo{max-height:65px;max-width:180px;object-fit:contain;margin-bottom:8px}.muted{color:#6b7280;margin-top:5px}.title{font-size:22px;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:28px 0}.label{color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase}.value{margin-top:5px;font-size:14px;font-weight:700}.amount{margin:24px 0;padding:18px 20px;border:1px solid #d1d5db;background:#f9fafb;display:flex;justify-content:space-between}.amount strong{font-size:25px}.signature{width:180px;border-top:1px solid #9ca3af;text-align:center;padding-top:8px;color:#6b7280;font-size:12px}.signatures{margin-top:55px;display:flex;justify-content:flex-end}.footer{margin-top:30px}.meta{margin-top:25px;font-size:12px;color:#94a3b8;display:flex;justify-content:space-between}@media print{body{padding:0;background:white}.sheet{border:0;max-width:none}@page{size:${size} ${orientation};margin:10mm}}</style></head><body><div class="sheet"><div class="top"><div>${visibility.show_logo && company.logo_url ? `<img class="logo" src="${escapePrintHtml(company.logo_url)}" alt="Company Logo"/>` : ""}${visibility.show_company_name ? `<div class="brand">${escapePrintHtml(companyName)}</div>` : ""}${visibility.show_address && company.address ? `<div class="muted">${escapePrintHtml(company.address)}</div>` : ""}${visibility.show_phone_email && contact ? `<div class="muted">${escapePrintHtml(contact)}</div>` : ""}${visibility.show_tax_details && tax ? `<div class="muted">${escapePrintHtml(tax)}</div>` : ""}</div><div style="text-align:right"><div class="title">Payment</div><div class="muted">${escapePrintHtml(receipt.entry_no)}</div></div></div>${visibility.show_header && company.document_header ? `<div class="footer">${escapePrintHtml(company.document_header)}</div>` : ""}<div class="grid"><div><div class="label">Paid To</div><div class="value">${escapePrintHtml(receipt.supplier_name)}</div></div><div><div class="label">Payment Date</div><div class="value">${escapePrintHtml(receipt.date)}</div></div><div><div class="label">Purchase Invoice</div><div class="value">${escapePrintHtml(receipt.invoice_no)}</div></div><div><div class="label">Payment Method</div><div class="value">${escapePrintHtml(receipt.payment_method)}</div></div><div><div class="label">Payment Account</div><div class="value">${escapePrintHtml(receipt.account)}</div></div></div>${visibility.show_previous_balance ? `<div class="amount"><span>Previous Balance</span><strong>${balanceDisplay(receipt.balance_before)}</strong></div>` : ""}<div class="amount"><span>Total Amount Paid</span><strong>${currentCurrency()} ${money(receipt.amount)}</strong></div>${visibility.show_closing_balance ? `<div class="amount"><span>Closing Balance</span><strong>${balanceDisplay(receipt.balance_after)}</strong></div>` : ""}${visibility.show_signatures ? `<div class="signatures"><div class="signature">${escapePrintHtml(company.approved_by_label || "Authorized Signature")}</div></div>` : ""}${visibility.show_footer && company.document_footer ? `<div class="footer muted">${escapePrintHtml(company.document_footer)}</div>` : ""}${visibility.show_print_datetime || visibility.show_page_numbers ? `<div class="meta"><span>${visibility.show_print_datetime ? `Printed: ${new Date().toLocaleString("en-PK")}` : ""}</span><span>${visibility.show_page_numbers ? "Page 1" : ""}</span></div>` : ""}</div><script>window.onload=function(){window.focus();setTimeout(function(){window.print()},300)}</script></body></html>`);
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
      if (visibility.show_previous_balance) { pdf.setFontSize(10); pdf.text("Previous Balance", margin, y); pdf.text(`${balanceDisplay(receipt.balance_before)}`, pageWidth - margin, y, { align: "right" }); y += 8; }
      pdf.text("Total Amount Paid", margin, y); pdf.text(`${currentCurrency()} ${money(receipt.amount)}`, pageWidth - margin, y, { align: "right" });
      if (visibility.show_closing_balance) { y += 8; pdf.setFontSize(10); pdf.text("Closing Balance", margin, y); pdf.text(`${balanceDisplay(receipt.balance_after)}`, pageWidth - margin, y, { align: "right" }); }
      if (visibility.show_signatures) { y += 22; pdf.line(pageWidth - margin - 55, y, pageWidth - margin, y); pdf.setFontSize(8); pdf.text(company.approved_by_label || "Authorized Signature", pageWidth - margin - 27.5, y + 5, { align: "center" }); }
      if (visibility.show_footer && company.document_footer) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text(company.document_footer, margin, pageHeight - 15); }
      if (visibility.show_print_datetime) { pdf.setFontSize(7); pdf.text(`Printed: ${new Date().toLocaleString("en-PK")}`, margin, pageHeight - 8); }
      if (visibility.show_page_numbers) { pdf.setFontSize(7); pdf.text("Page 1", pageWidth - margin, pageHeight - 8, { align: "right" }); }
      pdf.save(`${receipt.entry_no}-Supplier-Payment.pdf`);
    } catch (err: any) { setError(err?.message || "Failed to generate supplier payment PDF."); }
  };

  const handlePost = async () => {
    if (postingRef.current) return;
    setError(null); setSuccess(null);
    if (!supplierId) return setError("Select supplier");
    if (!selectedInvoices.length) return setError("Select open purchase invoices");
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return setError("Enter valid payment amount");
    if (!allocationValid || Math.abs(allocatedTotal-amountNumber)>0.005) return setError("Each invoice allocation must be valid and total allocations must equal Amount Paid.");
    if (!accountId) return setError("Select Payment Account.");
    postingRef.current = true;
    setSaving(true);
    try {
      const paymentPayload = multi
        ? {p_supplier_id:supplierId,p_payment_date:paymentDate,p_payment_account_id:accountId,p_payment_method:paymentMethod,p_reference:reference.trim()||null,p_notes:notes.trim()||null,p_allocations:selectedInvoices.map(o=>({purchase_order_id:o.id,amount:Number(invoiceAllocations[o.id])}))}
        : { p_supplier_id: supplierId, p_payment_date: paymentDate, p_payment_account_id: accountId, p_payment_method: paymentMethod, p_reference: reference.trim() || null, p_description: `Payment against ${selectedInvoices[0].order_no}`, p_notes: notes.trim() || null, p_purchase_order_id: selectedInvoices[0].id, p_amount: amountNumber };
      const payloadSignature = JSON.stringify(paymentPayload);
      if (paymentRequestRef.current?.payload !== payloadSignature) {
        paymentRequestRef.current = { id: crypto.randomUUID(), payload: payloadSignature };
      }
      const { data, error: rpcError } = await supabase.rpc("cash_counter_post_once", { p_request_id: paymentRequestRef.current.id, p_kind: multi ? "supplier_multi" : "supplier", p_payload: paymentPayload } as any);
      if (rpcError) throw rpcError;
      paymentRequestRef.current = null;
      const result = (data ?? {}) as { entry_no?: string; journal_entry_id?: string; payment_amount?: number };
      setSuccess(`Supplier payment posted successfully${result.entry_no ? ` — ${result.entry_no}` : ""}. ${currentCurrency()} ${money(result.payment_amount ?? amountNumber)}`);
      const selectedAccount = accounts.find((account) => account.id === accountId); const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
      let supplierBalanceSnapshot: { balance_before: number | null; payment_amount: number | null; balance_after: number | null } | null = null;
      if (result.journal_entry_id) { const { data: snapshotData, error: snapshotError } = await supabase.from("journal_entries").select("balance_before,payment_amount,balance_after").eq("id", result.journal_entry_id).maybeSingle(); if (!snapshotError) supplierBalanceSnapshot = snapshotData; }
      setLastPaymentReceipt({ entry_no: result.entry_no || "Supplier Payment", supplier_name: selectedSupplier?.name || "Supplier", invoice_no: selectedOrder.order_no, date: paymentDate, payment_method: paymentMethod, account: selectedAccount?.name || "—", amount: result.payment_amount ?? amountNumber, balance_before: supplierBalanceSnapshot?.balance_before ?? null, balance_after: supplierBalanceSnapshot?.balance_after ?? null });
      setOrderId(""); setInvoiceAllocations({}); setAmount(""); setReference(""); setNotes(""); setInvoiceReload(x=>x+1);
    } catch (err: any) { setError((err?.message || err?.details || err?.hint || "Failed to post supplier payment.") + " If the request timed out, check Posted Payments before retrying to avoid a duplicate payment."); } finally { postingRef.current = false; setSaving(false); }
  };

  if (loading) return <div className="flex min-h-[250px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>Loading supplier payments...</div>;

  return <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold text-slate-900">New Supplier Payment</h2><p className="mt-0.5 text-xs text-slate-500">Supplier → Select invoices → Allocate → One payment voucher</p></div><button type="button" onClick={() => void loadData()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"><RefreshCw className="h-4 w-4"/>Refresh</button></div>
    {activeBusinessUnit?.business_unit_type==="transport"&&<div className="flex gap-2 px-5 pt-3"><button type="button" className={transportMode?"btn-secondary":"btn-primary"} disabled={saving} onClick={()=>setTransportMode(false)}>Single invoice</button><button type="button" className={transportMode?"btn-primary":"btn-secondary"} disabled={saving} onClick={()=>setTransportMode(true)}>Transport invoices / Trips</button></div>}
    {transportMode?<div className="space-y-3 p-5"><label className="block text-xs font-semibold">Supplier<SearchableSelect value={supplierId} disabled={saving} onChange={e=>setSupplierId(e.target.value)} className="input w-full"><option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</SearchableSelect><QuickMasterAdd kind="supplier" compact disabled={saving} onCreated={createdSupplier}/></label><TransportCashSettlement side="supplier" party={supplierId} onBusyChange={setSaving} onPosted={()=>loadData(true)}/></div>:<div className="space-y-5 p-5">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{success}</div>}
      {lastPaymentReceipt && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="mr-2 text-xs font-bold text-slate-500">Payment Tools</span><button type="button" onClick={() => printPaymentReceipt(lastPaymentReceipt)} className="btn-secondary text-sm">Print</button><button type="button" onClick={() => downloadPaymentPdf(lastPaymentReceipt)} className="btn-secondary text-sm">PDF</button></div>}
      <div className="grid gap-4 md:grid-cols-3">
        <div><label className="mb-1.5 block text-xs font-semibold">Payment Date</label><NaviloDateInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3"/></div>
        <div><label className="mb-1.5 block text-xs font-semibold">Payment Method</label><SearchableSelect value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3"><option value="Cash">Cash</option><option value="Bank">Bank</option><option value="Cheque">Cheque</option><option value="Online">Online</option><option value="Other">Other</option></SearchableSelect></div>
        <div><label className="mb-1.5 block text-xs font-semibold">Payment Account</label><SearchableSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3"><option value="">Select payment account</option>{accounts.map((account) => <option key={account.id} value={account.id} data-search={account.code}>{account.name}</option>)}</SearchableSelect><QuickMasterAdd kind="account" compact disabled={saving} onRefresh={refreshPaymentAccounts}/></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold">Supplier</label><SearchableSelect value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setOrderId(""); setInvoiceAllocations({}); setAmount(""); setSuccess(null); }} className="h-10 w-full rounded-lg border border-slate-200 px-3"><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</SearchableSelect><QuickMasterAdd kind="supplier" compact disabled={saving} onCreated={createdSupplier}/></div><div><div className="mb-1.5 flex items-center justify-between gap-2"><label className="text-xs font-semibold">Open Purchase Invoice</label><button type="button" disabled={!supplierId||invoiceLoading||!(amountNumber>0)} onClick={autoAllocate} className="btn-secondary text-xs">Auto Allocate</button></div><SearchableSelect nativeCompatibility preserveLabel value={orderId} disabled={!supplierId || invoiceLoading} onChange={(e) => selectOrder(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 disabled:bg-slate-50"><option value="">{invoiceLoading?"Loading supplier invoices…":"— Add open invoice (partial allowed) —"}</option>{supplierOrders.filter(order=>!Object.prototype.hasOwnProperty.call(invoiceAllocations,order.id)).map((order) => <option key={order.id} value={order.id}>{order.payment_status==="partial"?"[PARTIAL] ":""}{order.order_no} — Outstanding {currentCurrency()} {money(order.outstanding_amount)}</option>)}</SearchableSelect></div></div>
      {selectedInvoices.length>0 && <div className="space-y-2 rounded-lg border border-slate-200 p-3"><div className="text-xs font-bold">Selected invoices — one payment voucher</div>{selectedInvoices.map(o=><div key={o.id} className="grid grid-cols-[1fr_130px_65px] items-center gap-2 text-xs"><span className="truncate">{o.order_no} · Due {currentCurrency()} {money(o.outstanding_amount)}</span><input aria-label={`Allocation for ${o.order_no}`} type="number" min="0" max={o.outstanding_amount} step="0.01" value={invoiceAllocations[o.id]} onChange={e=>setInvoiceAllocations(prev=>{
      const others=Object.entries(prev).reduce((sum,[id,val])=>id===o.id?sum:sum+Number(val||0),0);
      const max=Math.max(0,Math.min(o.outstanding_amount,amountNumber-others));
      const requested=Number(e.target.value||0);
      return {...prev,[o.id]:e.target.value===""?"":String(Number(Math.max(0,Math.min(requested,max)).toFixed(2)))};
    })} className="h-9 rounded border border-slate-300 px-2 text-right"/><button type="button" onClick={()=>setInvoiceAllocations(prev=>{const next={...prev};delete next[o.id];return next;})} className="text-rose-700">Remove</button></div>)}<div className="text-right text-xs font-bold">Allocated {currentCurrency()} {money(allocatedTotal)} / Paid {currentCurrency()} {money(amountNumber)}</div></div>}
      {selectedOrder && <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"><div><div className="text-xs text-slate-500">Invoice Total</div><div className="font-bold">{currentCurrency()} {money(selectedOrder.total)}</div></div><div><div className="text-xs text-slate-500">Paid</div><div className="font-bold">{currentCurrency()} {money(selectedOrder.paid_amount)}</div></div><div><div className="text-xs text-slate-500">Outstanding</div><div className="font-bold text-amber-700">{currentCurrency()} {money(selectedOrder.outstanding_amount)}</div></div></div>}
      <div className="grid gap-4 md:grid-cols-3"><div><label className="mb-1.5 block text-xs font-semibold">Amount Paid</label><input type="number" min="0" step="0.01" value={amount} onChange={(e) => {
        const value=e.target.value;
        setAmount(value);
        let remaining=Math.max(0,Number(value)||0);
        setInvoiceAllocations(prev=>{
          const next:Record<string,string>={};
          for(const [id,raw] of Object.entries(prev)){
            const due=supplierOrders.find(o=>o.id===id)?.outstanding_amount??0;
            const applied=Math.min(Math.max(0,Number(raw)||0),due,remaining);
            if(applied>=0.005){next[id]=String(Number(applied.toFixed(2)));remaining=Math.max(0,Number((remaining-applied).toFixed(2)));}
          }
          return next;
        });
      }} className="h-10 w-full rounded-lg border border-slate-200 px-3" placeholder="0.00"/></div><div><label className="mb-1.5 block text-xs font-semibold">Reference</label><input value={reference} onChange={(e) => setReference(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3" placeholder="Optional"/></div><div><label className="mb-1.5 block text-xs font-semibold">Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3" placeholder="Optional"/></div></div>
      <div className="flex justify-end border-t border-slate-200 pt-4"><button type="button" disabled={saving || !supplierId || !selectedInvoices.length || !accountId || amountNumber <= 0 || !allocationValid || Math.abs(allocatedTotal-amountNumber)>0.005} onClick={() => void handlePost()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? <><Loader2 className="h-4 w-4 animate-spin"/>Posting...</> : <><CheckCircle2 className="h-4 w-4"/>Pay & Post</>}</button></div>
    </div>}
  </section>;
}
