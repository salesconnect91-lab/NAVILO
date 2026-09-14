import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/components/ui";
import { ChargeBreakdownEntry } from "@/lib/chargeTypes";
import { supabase } from "@/lib/supabase";
import { QRCodeSVG } from "qrcode.react";

export interface PrintPartyInfo {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  ntn?: string | null;
  strn?: string | null;
  cnic?: string | null;
  taxRegistrationStatus?: string | null;
}

export interface PrintItemRow {
  name: string;
  description?: string | null;
  grade?: string | null;
  size?: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  taxPercent?: number;
  taxAmount?: number;
  hsCode?: string | null;
  unit?: string | null;
}

type PaymentSummary = {
  previousBalance?: number;
  totalReceived?: number;
  todayReceived?: number;
  lastPaymentAmount?: number;
  lastPaymentDate?: string | null;
  lastPaymentMode?: string | null;
  currentOutstanding?: number;
};

type PrintVisibility = {
  showCompanyName?: boolean;
  showLogo?: boolean;
  showAddress?: boolean;
  showPhoneEmail?: boolean;
  showTaxDetails?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  showSignatures?: boolean;
  showPrintDatetime?: boolean;
  showPageNumbers?: boolean;
  showQrCode?: boolean;
};

export interface PrintLayoutProps {
  voucherTitle: string;
  voucherNo: string;
  voucherDate: string;
  company: { name?: string; address?: string; phone?: string; email?: string; taxId?: string; logoUrl?: string };
  party: PrintPartyInfo;
  items: PrintItemRow[];
  chargeBreakdown: ChargeBreakdownEntry[];
  itemsTotal: number;
  chargesTotal: number;
  taxAmount?: number;
  showTaxSummary?: boolean;
  grandTotal: number;
  extraFields?: { label: string; value: string }[];
  hawalaDocuments?: { id: string; invoiceNo: string; invoiceDate?: string | null; referenceName?: string | null; referenceNo?: string | null; referenceNotes?: string | null; amount: number }[];
  normalInvoiceTotal?: number;
  documentNotice?: string;
  documentNoticeUrdu?: string;
  paymentSummary?: PaymentSummary;
  bilingual?: boolean;
  signatureLabels?: string[];
  visibility?: PrintVisibility;
  documentHeader?: string | null;
  documentHeaderUrdu?: string | null;
  documentFooter?: string | null;
  documentFooterUrdu?: string | null;
}

const n = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function urduTitle(title: string) {
  if (title === "Sales Invoice") return "فروخت کا بل";
  if (title === "Cash Bill") return "نقد بل";
  if (title === "Tax Invoice") return "ٹیکس انوائس";
  if (title === "Purchase Invoice") return "خریداری انوائس";
  if (title === "Purchase Tax Invoice") return "خریداری ٹیکس انوائس";
  if (title === "Unbilled Dispatch") return "حوالہ ڈسپیچ";
  return "دستاویز";
}

function normalize(value?: string | null) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function documentLanguageState() {
  const root = document.documentElement;
  const mode = root.dataset.documentLanguageMode === "bilingual" ? "bilingual" : "single";
  const primary = root.dataset.documentPrimaryLanguage || "en";
  const secondary = root.dataset.documentSecondaryLanguage || "";
  return { mode, primary, secondary };
}

function mapStoredVisibility(row: any): PrintVisibility {
  if (!row) return {};
  return {
    showCompanyName: row.show_company_name,
    showLogo: row.show_logo,
    showAddress: row.show_address,
    showPhoneEmail: row.show_phone_email,
    showTaxDetails: row.show_tax_details,
    showHeader: row.show_header,
    showFooter: row.show_footer,
    showSignatures: row.show_signatures,
    showPrintDatetime: row.show_print_datetime,
    showPageNumbers: row.show_page_numbers,
    showQrCode: row.show_qr_code,
  };
}

export default function PrintLayout({
  voucherTitle, voucherNo, voucherDate, company, party, items, chargeBreakdown, itemsTotal, chargesTotal,
  taxAmount = 0, showTaxSummary = false, grandTotal, extraFields, hawalaDocuments = [], normalInvoiceTotal,
  documentNotice, documentNoticeUrdu, paymentSummary, bilingual,
  signatureLabels = ["Authorized Signature / مجاز دستخط", "Customer Signature / گاہک دستخط"],
  visibility: visibilityProp = {}, documentHeader, documentHeaderUrdu, documentFooter, documentFooterUrdu,
}: PrintLayoutProps) {
  const language = documentLanguageState();
  const showEnglishText = language.primary === "en" || (language.mode === "bilingual" && language.secondary === "en");
  const showUrduText = language.primary === "ur" || (language.mode === "bilingual" && language.secondary === "ur");
  const effectiveBilingual = bilingual ?? (language.mode === "bilingual" && showEnglishText && showUrduText);

  const isPurchase = voucherTitle.toLowerCase().includes("purchase");
  const isSales = !isPurchase && ["sales invoice", "tax invoice", "cash bill"].includes(voucherTitle.toLowerCase());
  const [storedVisibility, setStoredVisibility] = useState<PrintVisibility>({});

  useEffect(() => {
    const documentType = isPurchase ? "purchase_invoice" : isSales ? "sales_invoice" : null;
    if (!documentType) {
      setStoredVisibility({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("document_print_visibility").select("*").eq("document_type", documentType).maybeSingle();
      if (!cancelled) setStoredVisibility(error ? {} : mapStoredVisibility(data));
    })();
    return () => { cancelled = true; };
  }, [isPurchase, isSales]);

  const visibility = { ...storedVisibility, ...visibilityProp };
  const {
    showCompanyName = true, showLogo = true, showAddress = true, showPhoneEmail = true, showTaxDetails = true,
    showHeader = true, showFooter = true, showSignatures = true, showPrintDatetime = false, showPageNumbers = true,
    showQrCode = false,
  } = visibility;

  const statusValue = String(extraFields?.find((field) => field.label.toLowerCase().includes("status"))?.value || "").toLowerCase();
  const isDraft = statusValue === "draft";
  const [livePaymentSummary, setLivePaymentSummary] = useState<PaymentSummary | null>(null);

  useEffect(() => {
    if (paymentSummary || (!isSales && !isPurchase) || !voucherNo) return;
    let cancelled = false;
    const loadFinancials = async () => {
      try {
        if (isPurchase) {
          const { data: order } = await supabase.from("purchase_orders")
            .select("id,supplier_id,paid_amount,outstanding_amount,order_date")
            .eq("order_no", voucherNo).maybeSingle();
          if (!order || cancelled) return;
          const [priorRes, paymentsRes] = await Promise.all([
            order.supplier_id
              ? supabase.from("supplier_invoice_aging").select("outstanding_amount").eq("supplier_id", order.supplier_id).lt("invoice_date", voucherDate)
              : Promise.resolve({ data: [] as any[] }),
            supabase.from("purchase_payment_allocations").select("amount,allocation_date,reference,journal_entry_id").eq("purchase_order_id", order.id).order("allocation_date", { ascending: false }).order("created_at", { ascending: false }),
          ]);
          const paymentRows = paymentsRes.data ?? [];
          const today = new Date().toISOString().slice(0, 10);
          const last = paymentRows[0];
          let lastMode = last?.reference || null;
          if (last?.journal_entry_id) {
            const { data: journal } = await supabase.from("journal_entries").select("payment_mode").eq("id", last.journal_entry_id).maybeSingle();
            lastMode = journal?.payment_mode || lastMode;
          }
          if (!cancelled) setLivePaymentSummary({
            previousBalance: (priorRes.data ?? []).reduce((sum: number, row: any) => sum + n(row.outstanding_amount), 0),
            totalReceived: n(order.paid_amount),
            todayReceived: paymentRows.filter((row: any) => row.allocation_date === today).reduce((sum: number, row: any) => sum + n(row.amount), 0),
            lastPaymentAmount: n(last?.amount), lastPaymentDate: last?.allocation_date || null, lastPaymentMode: lastMode,
            currentOutstanding: isDraft ? Math.max(n(grandTotal) - n(order.paid_amount), 0) : n(order.outstanding_amount),
          });
        } else {
          const { data: order } = await supabase.from("sales_orders")
            .select("id,customer_id,paid_amount,outstanding_amount,order_date")
            .eq("order_no", voucherNo).maybeSingle();
          if (!order || cancelled) return;
          const [priorRes, receiptsRes] = await Promise.all([
            order.customer_id
              ? supabase.from("customer_invoice_aging").select("outstanding_amount").eq("customer_id", order.customer_id).lt("invoice_date", voucherDate)
              : Promise.resolve({ data: [] as any[] }),
            supabase.from("invoice_payment_allocations").select("amount,allocation_date,reference,journal_entry_id").eq("sales_order_id", order.id).order("allocation_date", { ascending: false }).order("created_at", { ascending: false }),
          ]);
          const receiptRows = receiptsRes.data ?? [];
          const today = new Date().toISOString().slice(0, 10);
          const last = receiptRows[0];
          let lastMode = last?.reference || null;
          if (last?.journal_entry_id) {
            const { data: journal } = await supabase.from("journal_entries").select("payment_mode").eq("id", last.journal_entry_id).maybeSingle();
            lastMode = journal?.payment_mode || lastMode;
          }
          if (!cancelled) setLivePaymentSummary({
            previousBalance: (priorRes.data ?? []).reduce((sum: number, row: any) => sum + n(row.outstanding_amount), 0),
            totalReceived: n(order.paid_amount),
            todayReceived: receiptRows.filter((row: any) => row.allocation_date === today).reduce((sum: number, row: any) => sum + n(row.amount), 0),
            lastPaymentAmount: n(last?.amount), lastPaymentDate: last?.allocation_date || null, lastPaymentMode: lastMode,
            currentOutstanding: isDraft ? Math.max(n(grandTotal) - n(order.paid_amount), 0) : n(order.outstanding_amount),
          });
        }
      } catch {
        if (!cancelled) setLivePaymentSummary(null);
      }
    };
    void loadFinancials();
    return () => { cancelled = true; };
  }, [grandTotal, isDraft, isPurchase, isSales, paymentSummary, voucherDate, voucherNo]);

  const draftFallback: PaymentSummary | null = isDraft && (isSales || isPurchase)
    ? { previousBalance: 0, totalReceived: 0, todayReceived: 0, lastPaymentAmount: 0, lastPaymentDate: null, lastPaymentMode: null, currentOutstanding: n(grandTotal) }
    : null;
  const effectivePayment = paymentSummary ?? livePaymentSummary ?? draftFallback;
  const itemVat = useMemo(() => items.reduce((sum, item) => sum + n(item.taxAmount), 0), [items]);
  const chargeVat = Math.max(n(taxAmount) - itemVat, 0);
  const itemGridClass = showTaxSummary ? "invoice-items-grid invoice-items-grid-tax" : "invoice-items-grid invoice-items-grid-no-tax";
  const itemGridStyle = {
    gridTemplateColumns: showTaxSummary
      ? "24px minmax(135px,1.05fr) minmax(115px,0.9fr) 70px 62px 82px 84px 98px"
      : "24px minmax(165px,1.1fr) minmax(130px,0.95fr) 74px 68px 92px 106px",
  };
  const partyLabel = isPurchase ? "Supplier / سپلائر" : "Bill To / گاہک";
  const qrPayload = JSON.stringify({ company: company.name || "", taxId: company.taxId || "", documentType: voucherTitle, documentNo: voucherNo, documentDate: voucherDate, party: party.name, amount: n(grandTotal).toFixed(2), tax: n(taxAmount).toFixed(2) });
  const duplicateEnglishHeader = normalize(documentHeader) && normalize(documentHeader) === normalize(company.name);
  const visibleEnglishHeader = showEnglishText && documentHeader && !duplicateEnglishHeader ? documentHeader : null;
  const visibleUrduHeader = showUrduText ? documentHeaderUrdu : null;
  const visibleEnglishFooter = showEnglishText ? documentFooter : null;
  const visibleUrduFooter = showUrduText ? documentFooterUrdu : null;

  return <div className="print-document"><div className="print-page">
    <div className="print-header">
      <div className="print-company">
        {showLogo && company.logoUrl && <img src={company.logoUrl} alt="Company Logo" className="print-logo" />}
        <div>
          {showCompanyName && company.name && (!showLogo || !company.logoUrl) && <h1 className="print-company-name">{company.name}</h1>}
          {showAddress && company.address && <p className="print-company-addr">{company.address}</p>}
          {showPhoneEmail && (company.phone || company.email) && <p className="print-company-addr">{[company.phone ? `Phone / فون: ${company.phone}` : "", company.email || ""].filter(Boolean).join(" · ")}</p>}
          {showTaxDetails && company.taxId && <p className="print-company-tax">NTN / STRN / ٹیکس نمبر: {company.taxId}</p>}
        </div>
      </div>
      <div className="print-voucher-title-box" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
        <div><h2 className="print-voucher-title">{voucherTitle}{effectiveBilingual ? ` / ${urduTitle(voucherTitle)}` : ""}</h2>{showQrCode && <div style={{ marginTop: 3, textAlign: "right", fontSize: 9, color: "#64748b" }}>Internal Document QR / دستاویزی QR</div>}</div>
        {showQrCode && <div style={{ background: "#fff", padding: 2, lineHeight: 0, breakInside: "avoid" }}><QRCodeSVG value={qrPayload} size={62} level="M" includeMargin={false} /></div>}
      </div>
    </div>

    {showHeader && (visibleEnglishHeader || visibleUrduHeader) && <div style={{ textAlign: "center", margin: "6px 0 10px", fontSize: 11, color: "#475569" }}>{visibleEnglishHeader && <div>{visibleEnglishHeader}</div>}{visibleUrduHeader && <div>{visibleUrduHeader}</div>}</div>}
    {(documentNotice || documentNoticeUrdu) && <div style={{ margin: "0 0 10px", border: "1px solid #cbd5e1", background: "#f8fafc", padding: "6px 9px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#334155" }}>{showEnglishText && documentNotice && <div>{documentNotice}</div>}{showUrduText && documentNoticeUrdu && <div>{documentNoticeUrdu}</div>}</div>}

    <div className="print-meta">
      <div className="print-meta-col">
        <div className="print-meta-row"><span className="print-meta-label">{voucherTitle} No / بل نمبر:</span><span className="print-meta-value">{voucherNo}</span></div>
        <div className="print-meta-row"><span className="print-meta-label">Date / تاریخ:</span><span className="print-meta-value">{formatDate(voucherDate)}</span></div>
        {extraFields?.map((field) => <div key={field.label} className="print-meta-row"><span className="print-meta-label">{field.label}:</span><span className="print-meta-value">{field.value}</span></div>)}
      </div>
      <div className="print-meta-col"><div className="print-party-box">
        <div className="print-party-label">{partyLabel}</div><div className="print-party-name">{party.name}</div>
        {party.address && <div className="print-party-addr">{party.address}</div>}{party.phone && <div className="print-party-phone">Phone / فون: {party.phone}</div>}{party.email && <div className="print-party-email">{party.email}</div>}
        {showTaxDetails && (party.strn || party.ntn || party.cnic) && <div className="print-party-tax" style={{ marginTop: 4, fontSize: 10, color: "#475569" }}>{[party.strn ? `STRN: ${party.strn}` : "", party.ntn ? `NTN: ${party.ntn}` : "", party.cnic ? `CNIC: ${party.cnic}` : ""].filter(Boolean).join(" · ")}</div>}
        {showTaxDetails && party.taxRegistrationStatus && <div style={{ marginTop: 2, fontSize: 9, color: "#64748b", textTransform: "capitalize" }}>Tax Status: {party.taxRegistrationStatus}</div>}
      </div></div>
    </div>

    <div className="invoice-items-wrap">
      <div className={`${itemGridClass} invoice-items-head`} style={itemGridStyle}>
        <div>#</div><div>Item / آئٹم</div><div>Description / تفصیل</div><div>Grade / گریڈ</div><div className="invoice-num">Qty / مقدار</div><div className="invoice-num">Rate / ریٹ</div>{showTaxSummary && <div className="invoice-num">VAT / ٹیکس</div>}<div className="invoice-num invoice-amount-col">Amount / رقم</div>
      </div>
      {items.map((item, index) => {
        const baseAmount = n(item.qty) * n(item.unitPrice);
        return <div key={index} className={`${itemGridClass} invoice-items-row`} style={itemGridStyle}>
          <div className="invoice-center">{index + 1}</div>
          <div className="invoice-item-name"><div>{item.name}</div>{(item.hsCode || item.unit) && <div className="invoice-item-description">{[item.hsCode ? `HS: ${item.hsCode}` : "", item.unit ? `UOM: ${item.unit}` : ""].filter(Boolean).join(" · ")}</div>}</div>
          <div className="invoice-item-description" style={{ color: item.description ? "#334155" : "#94a3b8", fontStyle: item.description ? "normal" : "italic" }}>{item.description || "—"}</div>
          <div>{item.grade ?? "—"}</div><div className="invoice-num">{item.qty}</div><div className="invoice-num">{formatCurrency(item.unitPrice)}</div>
          {showTaxSummary && <div className="invoice-num invoice-vat-col"><div>{formatCurrency(item.taxAmount || 0)}</div><div className="invoice-tax-rate">{item.taxPercent || 0}%</div></div>}
          <div className="invoice-num invoice-amount-col">{formatCurrency(baseAmount || item.lineTotal)}</div>
        </div>;
      })}
    </div>

    {hawalaDocuments.length > 0 && <div style={{ marginTop: 12, border: "1px solid #cbd5e1", borderRadius: 4, overflow: "hidden", breakInside: "avoid" }}>
      <div style={{ padding: "7px 9px", background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}><div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>Unbilled Dispatch Details / حوالہ تفصیل</div><div style={{ marginTop: 2, fontSize: 10, color: "#64748b" }}>Unbilled dispatch documents included in this Sales Invoice / اس فروخت بل میں شامل حوالہ دستاویزات</div></div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}><thead><tr style={{ background: "#f8fafc" }}><th style={{ padding: 5, borderBottom: "1px solid #cbd5e1", textAlign: "left" }}>Dispatch No.</th><th style={{ padding: 5, borderBottom: "1px solid #cbd5e1", textAlign: "left" }}>Date</th><th style={{ padding: 5, borderBottom: "1px solid #cbd5e1", textAlign: "left" }}>Reference Name</th><th style={{ padding: 5, borderBottom: "1px solid #cbd5e1", textAlign: "left" }}>Reference No.</th><th style={{ padding: 5, borderBottom: "1px solid #cbd5e1", textAlign: "right" }}>Amount</th></tr></thead>
      <tbody>{hawalaDocuments.map((row) => <tr key={row.id}><td style={{ padding: 5, borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>{row.invoiceNo}</td><td style={{ padding: 5, borderBottom: "1px solid #e2e8f0" }}>{row.invoiceDate ? formatDate(row.invoiceDate) : "—"}</td><td style={{ padding: 5, borderBottom: "1px solid #e2e8f0" }}>{row.referenceName || "—"}</td><td style={{ padding: 5, borderBottom: "1px solid #e2e8f0" }}>{row.referenceNo || "—"}</td><td style={{ padding: 5, borderBottom: "1px solid #e2e8f0", textAlign: "right", fontWeight: 600 }}>{formatCurrency(row.amount)}</td></tr>)}</tbody>
      <tfoot><tr style={{ background: "#f8fafc" }}><td colSpan={4} style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>Unbilled Dispatch Total / کل حوالہ رقم</td><td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>{formatCurrency(hawalaDocuments.reduce((sum, row) => sum + n(row.amount), 0))}</td></tr></tfoot></table>
    </div>}

    <div className="print-totals-section">
      <div className="print-charges-side">{chargeBreakdown.length > 0 && <div className="print-charges-box"><div className="print-charges-title">Charges Breakdown / چارجز کی تفصیل</div>{chargeBreakdown.map((charge) => <div key={charge.label} className="print-charge-row"><span>{charge.label}</span><span>{formatCurrency(charge.amount)}</span></div>)}<div className="print-charge-row print-charge-total"><span>Charges Total / کل چارجز</span><span>{formatCurrency(chargesTotal)}</span></div>{showTaxSummary && chargeVat > 0 && <div className="print-charge-row"><span>Charges VAT / چارجز ٹیکس</span><span>{formatCurrency(chargeVat)}</span></div>}</div>}</div>
      <div className="print-totals-side">
        <div className="print-total-row"><span>Items Total / آئٹمز کل</span><span>{formatCurrency(itemsTotal)}</span></div><div className="print-total-row"><span>Charges Total / کل چارجز</span><span>{formatCurrency(chargesTotal)}</span></div>
        {showTaxSummary && <><div className="print-total-row"><span>Items VAT / آئٹمز ٹیکس</span><span>{formatCurrency(itemVat)}</span></div>{chargeVat > 0 && <div className="print-total-row"><span>Charges VAT / چارجز ٹیکس</span><span>{formatCurrency(chargeVat)}</span></div>}<div className="print-total-row"><span>Total VAT / کل ٹیکس</span><span>{formatCurrency(taxAmount)}</span></div></>}
        {hawalaDocuments.length > 0 && <><div className="print-total-row"><span>Normal Invoice Total / اصل انوائس رقم</span><span>{formatCurrency(normalInvoiceTotal ?? Math.max(grandTotal - hawalaDocuments.reduce((sum, row) => sum + n(row.amount), 0), 0))}</span></div><div className="print-total-row"><span>Unbilled Dispatch Total / کل حوالہ رقم</span><span>{formatCurrency(hawalaDocuments.reduce((sum, row) => sum + n(row.amount), 0))}</span></div></>}
        <div className="print-total-row print-grand-total"><span>Grand Total / کل رقم</span><span>{formatCurrency(grandTotal)}</span></div>
      </div>
    </div>

    {effectivePayment && <div className="print-payment-summary" style={{ marginTop: 12, border: "1px solid #cbd5e1", padding: 10, breakInside: "avoid" }}>
      <div style={{ fontWeight: 700, marginBottom: 7 }}>{isPurchase ? "Payment & Balance / ادائیگی اور بقایا" : "Receipt & Balance / وصولی اور بقایا"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7, fontSize: 10 }}>
        <div>Previous Balance / سابقہ بقایا<br/><strong>{formatCurrency(effectivePayment.previousBalance || 0)}</strong></div>
        <div>{isPurchase ? "Total Paid / کل ادائیگی" : "Total Received / کل وصولی"}<br/><strong>{formatCurrency(effectivePayment.totalReceived || 0)}</strong></div>
        <div>{isPurchase ? "Today's Paid / آج کی ادائیگی" : "Today's Received / آج کی وصولی"}<br/><strong>{formatCurrency(effectivePayment.todayReceived || 0)}</strong></div>
        <div>Outstanding / موجودہ بقایا<br/><strong>{formatCurrency(effectivePayment.currentOutstanding || 0)}</strong></div>
      </div>
      <div style={{ marginTop: 7, fontSize: 10 }}>{isPurchase ? "Last Payment / آخری ادائیگی" : "Last Receipt / آخری وصولی"}: <strong>{effectivePayment.lastPaymentDate ? formatDate(effectivePayment.lastPaymentDate) : "—"}</strong> · <strong>{formatCurrency(effectivePayment.lastPaymentAmount || 0)}</strong> · {effectivePayment.lastPaymentMode || "—"}</div>
    </div>}

    {showSignatures && signatureLabels.length > 0 && <div className="print-signatures">{signatureLabels.map((label, index) => <div key={`${label}-${index}`} className="print-signature-block"><div className="print-signature-line"/><div className="print-signature-label">{label}</div></div>)}</div>}
    {showFooter && <div className="print-footer">{visibleEnglishFooter && <p>{visibleEnglishFooter}</p>}{visibleUrduFooter && <p>{visibleUrduFooter}</p>}{!visibleEnglishFooter && !visibleUrduFooter && <p>This is a computer-generated document.</p>}</div>}
    {showPrintDatetime && <div style={{ marginTop: 7, textAlign: "right", fontSize: 10, color: "#94a3b8" }}>Printed / پرنٹ: {new Date().toLocaleString("en-PK")}</div>}
    {showPageNumbers && <div className="print-page-number" style={{ marginTop: 3, textAlign: "right", fontSize: 10, color: "#94a3b8" }}/>} 
  </div></div>;
}
