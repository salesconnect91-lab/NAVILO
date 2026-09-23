import { useEffect, useMemo, useState } from "react";
import { FileText, Printer } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/lib/supabase";

type LinkedInvoice = {
  id: string;
  sales_order_id: string;
  reference_name: string | null;
  reference_no: string | null;
  remarks: string | null;
  sales_order?: {
    id: string;
    order_no: string;
    order_date: string;
    total: number | string;
  } | null;
};

type Line = {
  id: string;
  order_id: string;
  qty: number | string;
  unit_price: number | string;
  line_total: number | string;
  tax_percent: number | string | null;
  item?: {
    sku?: string | null;
    name?: string | null;
  } | null;
};

type Allocation = {
  id: string;
  sales_order_id: string;
  allocation_date: string;
  amount: number | string;
  reference: string | null;
  notes: string | null;
};

type Snapshot = {
  previous_balance: number | string | null;
  bills_total: number | string | null;
  received_amount: number | string | null;
  closing_balance: number | string | null;
  status: string;
};

type Props = {
  consolidationId: string;
  consolidationNo: string;
  customerName: string;
  consolidationDate: string;
  linkedInvoices: LinkedInvoice[];
};

const n = (value: unknown) => Number(value || 0);

const money = (value: unknown) =>
  `Rs ${n(value).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function ConsolidatedInvoiceBreakdown({
  consolidationId,
  consolidationNo,
  customerName,
  consolidationDate,
  linkedInvoices,
}: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");

    const orderIds = linkedInvoices.map((row) => row.sales_order_id);

    const [snapshotRes, linesRes, allocationsRes] = await Promise.all([
      supabase
        .from("sales_consolidations")
        .select(
          "previous_balance,bills_total,received_amount,closing_balance,status"
        )
        .eq("id", consolidationId)
        .single(),

      orderIds.length
        ? supabase
            .from("sales_order_lines")
            .select(
              "id,order_id,qty,unit_price,line_total,tax_percent,item:items(sku,name)"
            )
            .in("order_id", orderIds)
            .order("created_at")
        : Promise.resolve({ data: [], error: null } as any),

      orderIds.length
        ? supabase
            .from("invoice_payment_allocations")
            .select(
              "id,sales_order_id,allocation_date,amount,reference,notes"
            )
            .in("sales_order_id", orderIds)
            .order("allocation_date")
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (snapshotRes.error) {
      setError(snapshotRes.error.message);
      return;
    }

    if (linesRes.error) {
      setError(linesRes.error.message);
      return;
    }

    if (allocationsRes.error) {
      setError(allocationsRes.error.message);
      return;
    }

    setSnapshot(snapshotRes.data as Snapshot);
    setLines((linesRes.data ?? []) as unknown as Line[]);
    setAllocations((allocationsRes.data ?? []) as Allocation[]);
  };

  useEffect(() => {
    void load();
  }, [consolidationId, linkedInvoices]);

  const calculatedBills = useMemo(
    () =>
      linkedInvoices.reduce(
        (sum, row) => sum + n(row.sales_order?.total),
        0
      ),
    [linkedInvoices]
  );

  const calculatedReceived = useMemo(
    () => allocations.reduce((sum, row) => sum + n(row.amount), 0),
    [allocations]
  );

  const billsTotal =
    snapshot?.bills_total !== null &&
    snapshot?.bills_total !== undefined
      ? n(snapshot.bills_total)
      : calculatedBills;

  const receivedAmount =
    snapshot?.received_amount !== null &&
    snapshot?.received_amount !== undefined
      ? n(snapshot.received_amount)
      : calculatedReceived;

  const previousBalance =
    snapshot?.previous_balance !== null &&
    snapshot?.previous_balance !== undefined
      ? n(snapshot.previous_balance)
      : 0;

  const closingBalance =
    snapshot?.closing_balance !== null &&
    snapshot?.closing_balance !== undefined
      ? n(snapshot.closing_balance)
      : previousBalance + billsTotal - receivedAmount;

  const detailedHtml = () =>
    linkedInvoices
      .map((invoice, index) => {
        const invoiceLines = lines.filter(
          (line) => line.order_id === invoice.sales_order_id
        );

        const invoicePayments = allocations.filter(
          (payment) =>
            payment.sales_order_id === invoice.sales_order_id
        );

        return `
          <section style="margin-top:24px;page-break-inside:avoid">
            <div style="background:#f1f5f9;padding:10px;display:flex;justify-content:space-between">
              <strong>${index + 1}. ${invoice.sales_order?.order_no || ""}</strong>
              <strong>${money(invoice.sales_order?.total)}</strong>
            </div>

            <div style="font-size: 12px;padding:8px 0">
              <strong>Date:</strong> ${invoice.sales_order?.order_date || ""}
              &nbsp;&nbsp;
              <strong>Hawala:</strong> ${invoice.reference_name || "—"}
              &nbsp;&nbsp;
              <strong>Reference:</strong> ${invoice.reference_no || "—"}
            </div>

            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item</th>
                  <th style="text-align:right">Qty</th>
                  <th style="text-align:right">Rate</th>
                  <th style="text-align:right">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${invoiceLines
                  .map(
                    (line) => `
                    <tr>
                      <td>${line.item?.sku || "—"}</td>
                      <td>${line.item?.name || "—"}</td>
                      <td style="text-align:right">${n(line.qty).toLocaleString()}</td>
                      <td style="text-align:right">${money(line.unit_price)}</td>
                      <td style="text-align:right">${money(line.line_total)}</td>
                    </tr>
                  `
                  )
                  .join("")}
              </tbody>
            </table>

            ${
              invoicePayments.length
                ? `
                <div style="margin-top:8px;font-size:11px">
                  <strong>Payments:</strong>
                  ${invoicePayments
                    .map(
                      (payment) =>
                        `${payment.allocation_date} — ${money(payment.amount)}${
                          payment.reference
                            ? ` (${payment.reference})`
                            : ""
                        }`
                    )
                    .join(" | ")}
                </div>
              `
                : ""
            }
          </section>
        `;
      })
      .join("");

  const printDetailed = () => {
    const win = window.open("", "_blank", "width=1100,height=850");

    if (!win) return;

    win.document.write(`
      <!doctype html>
      <html>
      <head>
        <title>${consolidationNo}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:28px;color:#0f172a}
          h1{text-align:center;margin:0}
          .sub{text-align:center;color:#64748b;margin:6px 0 20px}
          table{width:100%;border-collapse:collapse}
          th,td{border:1px solid #cbd5e1;padding:7px;font-size:11px}
          th{background:#f8fafc;text-align:left}
          .summary{margin-top:24px;margin-left:auto;width:380px}
          .summary div{display:flex;justify-content:space-between;padding:7px;border-bottom:1px solid #e2e8f0}
          .closing{font-size:16px;font-weight:bold;border-top:2px solid #0f172a!important}
          .note{margin-top:20px;font-size: 12px;color:#64748b}
        </style>
      </head>
      <body>
        <h1>Consolidated Invoice</h1>
        <div class="sub">${consolidationNo}</div>

        <div style="font-size:12px">
          <strong>Main Customer:</strong> ${customerName}<br/>
          <strong>Date:</strong> ${consolidationDate}
        </div>

        ${detailedHtml()}

        <div class="summary">
          <div>
            <span>Previous Balance</span>
            <strong>${money(previousBalance)}</strong>
          </div>
          <div>
            <span>Current Bills</span>
            <strong>${money(billsTotal)}</strong>
          </div>
          <div>
            <span>Received</span>
            <strong>${money(receivedAmount)}</strong>
          </div>
          <div class="closing">
            <span>Closing Balance</span>
            <strong>${money(closingBalance)}</strong>
          </div>
        </div>

        <div class="note">
          Consolidated document only. Original posted invoices remain the source
          of stock, COGS, sales revenue and customer ledger postings.
        </div>
      </body>
      </html>
    `);

    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const downloadPdf = () => {
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Consolidated Invoice", 14, 16);

    doc.setFontSize(10);
    doc.text(`No: ${consolidationNo}`, 14, 24);
    doc.text(`Customer: ${customerName}`, 14, 30);
    doc.text(`Date: ${consolidationDate}`, 14, 36);

    let y = 44;

    linkedInvoices.forEach((invoice, index) => {
      const invoiceLines = lines.filter(
        (line) => line.order_id === invoice.sales_order_id
      );

      if (y > 235) {
        doc.addPage();
        y = 18;
      }

      doc.setFontSize(10);
      doc.text(
        `${index + 1}. ${invoice.sales_order?.order_no || ""} | Hawala: ${
          invoice.reference_name || "-"
        } | ${money(invoice.sales_order?.total)}`,
        14,
        y
      );

      autoTable(doc, {
        startY: y + 4,
        head: [["SKU", "Item", "Qty", "Rate", "Amount"]],
        body: invoiceLines.map((line) => [
          line.item?.sku || "",
          line.item?.name || "",
          n(line.qty).toLocaleString(),
          money(line.unit_price),
          money(line.line_total),
        ]),
        styles: { fontSize: 8 },
        margin: { left: 14, right: 14 },
      });

      y = (doc as any).lastAutoTable.finalY + 10;
    });

    if (y > 230) {
      doc.addPage();
      y = 20;
    }

    autoTable(doc, {
      startY: y,
      body: [
        ["Previous Balance", money(previousBalance)],
        ["Current Bills", money(billsTotal)],
        ["Received", money(receivedAmount)],
        ["Closing Balance", money(closingBalance)],
      ],
      styles: { fontSize: 9 },
      columnStyles: {
        1: { halign: "right", fontStyle: "bold" },
      },
      margin: { left: 95, right: 14 },
    });

    doc.save(`${consolidationNo}.pdf`);
  };

  return (
    <div className="mt-5 space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={printDetailed}>
          <Printer className="h-4 w-4" />
          Detailed Print
        </button>

        <button type="button" className="btn" onClick={downloadPdf}>
          <FileText className="h-4 w-4" />
          Detailed PDF
        </button>
      </div>

      {linkedInvoices.map((invoice) => {
        const invoiceLines = lines.filter(
          (line) => line.order_id === invoice.sales_order_id
        );

        const invoicePayments = allocations.filter(
          (payment) =>
            payment.sales_order_id === invoice.sales_order_id
        );

        return (
          <div key={invoice.id} className="overflow-hidden rounded-xl border">
            <div className="flex flex-col gap-2 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-bold">
                  {invoice.sales_order?.order_no}
                </div>
                <div className="text-xs text-slate-500">
                  {invoice.sales_order?.order_date} • Hawala:{" "}
                  <strong>{invoice.reference_name || "—"}</strong>
                </div>
              </div>

              <div className="font-bold">
                {money(invoice.sales_order?.total)}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="px-4 py-2">SKU</th>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Rate</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>

                <tbody>
                  {invoiceLines.map((line) => (
                    <tr key={line.id} className="border-b">
                      <td className="px-4 py-2">
                        {line.item?.sku || "—"}
                      </td>
                      <td className="px-4 py-2">
                        {line.item?.name || "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {n(line.qty).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {money(line.unit_price)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold">
                        {money(line.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {invoicePayments.length > 0 && (
              <div className="border-t bg-emerald-50/50 px-4 py-3 text-xs">
                <div className="mb-2 font-semibold">
                  Payments
                </div>

                {invoicePayments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex justify-between py-1"
                  >
                    <span>
                      {payment.allocation_date}
                      {payment.reference
                        ? ` • ${payment.reference}`
                        : ""}
                    </span>
                    <strong>{money(payment.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="ml-auto max-w-md rounded-xl border bg-white p-4 text-sm">
        <div className="flex justify-between py-2">
          <span>Previous Balance</span>
          <strong>{money(previousBalance)}</strong>
        </div>

        <div className="flex justify-between border-t py-2">
          <span>Current Bills</span>
          <strong>{money(billsTotal)}</strong>
        </div>

        <div className="flex justify-between border-t py-2 text-emerald-700">
          <span>Received</span>
          <strong>- {money(receivedAmount)}</strong>
        </div>

        <div className="flex justify-between border-t-2 border-slate-900 pt-3 text-base font-bold">
          <span>Closing Balance</span>
          <strong>{money(closingBalance)}</strong>
        </div>
      </div>
    </div>
  );
}
