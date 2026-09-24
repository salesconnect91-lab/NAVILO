import { useCallback, useEffect, useState } from "react";
import {
  FileDown,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import jsPDF from "jspdf";
import { supabase } from "@/lib/supabase";

type Mode = "customer" | "supplier";

type Voucher = {
  id: string;
  entry_no: string;
  entry_date: string;
  description: string | null;
  trans_type: string | null;
  party_name: string | null;
  payment_mode: string | null;
  balance_before: number | null;
  payment_amount: number | null;
  balance_after: number | null;
};

type VoucherDetail = Voucher & {
  account: string;
  amount: number;
};

type Visibility = {
  show_previous_balance: boolean;
  show_closing_balance: boolean;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export default function PaymentVoucherHistory({
  mode,
}: {
  mode: Mode;
}) {
  const [rows, setRows] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] =
    useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const transactionType =
    mode === "customer"
      ? "Customer Receipt"
      : "Supplier Payment";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from("journal_entries")
        .select(
          "id,entry_no,entry_date,description,trans_type,party_name,payment_mode,balance_before,payment_amount,balance_after"
        )
        .eq("status", "posted")
        .eq("trans_type", transactionType)
        .order("entry_date", { ascending: false })
        .order("entry_no", { ascending: false })
        .limit(50);

      if (error) throw error;

      setRows((data || []) as Voucher[]);
    } catch (err: any) {
      setError(
        err?.message || "Failed to load payment history."
      );
    } finally {
      setLoading(false);
    }
  }, [transactionType]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadVisibility = async (): Promise<Visibility> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        show_previous_balance: true,
        show_closing_balance: true,
      };
    }

    const { data } = await supabase
      .from("document_print_visibility")
      .select(
        "show_previous_balance,show_closing_balance"
      )
      .eq("document_type", "receipt_payment")
      .maybeSingle();

    return {
      show_previous_balance:
        data?.show_previous_balance ?? true,
      show_closing_balance:
        data?.show_closing_balance ?? true,
    };
  };

  const loadCompany = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data } = await supabase
      .from("company_settings")
      .select("*")
      .maybeSingle();

    return data as any;
  };

  const getDetail = async (
    voucher: Voucher
  ): Promise<VoucherDetail> => {
    const { data: lines, error } = await supabase
      .from("journal_lines")
      .select("account,debit,credit")
      .eq("entry_id", voucher.id);

    if (error) throw error;

    const paymentLine =
      mode === "customer"
        ? (lines || []).find(
            (line: any) => Number(line.debit || 0) > 0
          )
        : (lines || []).find(
            (line: any) => Number(line.credit || 0) > 0
          );

    const derivedAmount =
      mode === "customer"
        ? Number(paymentLine?.debit || 0)
        : Number(paymentLine?.credit || 0);

    return {
      ...voucher,
      account:
        paymentLine?.account || "Cash / Bank",
      amount: Number(
        voucher.payment_amount ?? derivedAmount ?? 0
      ),
    };
  };

  const printVoucher = async (voucher: Voucher) => {
    setWorkingId(voucher.id);
    setError(null);

    try {
      const [detail, visibility, company] =
        await Promise.all([
          getDetail(voucher),
          loadVisibility(),
          loadCompany(),
        ]);

      const popup = window.open(
        "",
        "_blank",
        "width=900,height=900"
      );

      if (!popup) {
        throw new Error(
          "Please allow pop-ups to print the voucher."
        );
      }

      const title =
        mode === "customer"
          ? "Receipt"
          : "Payment";

      const amountLabel =
        mode === "customer"
          ? "Amount Received"
          : "Amount Paid";

      const companyName =
        company?.company_name ||
        company?.name ||
        "Company";

      popup.document.write(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(detail.entry_no)} - ${title}</title>
<style>
body{font-family:Arial,sans-serif;margin:36px;color:#0f172a}
.header{display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:18px;margin-bottom:24px}
.company{font-size:26px;font-weight:800}
.title{text-align:right;font-size:22px;font-weight:800}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.label{font-size: 12px;color:#64748b;text-transform:uppercase;margin-bottom:5px}
.value{font-size:15px;font-weight:700}
.amount{display:flex;justify-content:space-between;align-items:center;border:1px solid #cbd5e1;padding:18px;margin:14px 0}
.amount strong{font-size:25px}
.note{margin-top:22px;font-size:12px;color:#64748b}
@media print{body{margin:18px}}
</style>
</head>
<body>
<div class="header">
  <div class="company">${escapeHtml(companyName)}</div>
  <div class="title">
    ${title}
    <div style="font-size:14px;margin-top:6px;font-weight:500">
      ${escapeHtml(detail.entry_no)}
    </div>
  </div>
</div>

<div class="meta">
  <div>
    <div class="label">${
      mode === "customer"
        ? "Received From"
        : "Paid To"
    }</div>
    <div class="value">${escapeHtml(
      detail.party_name || "—"
    )}</div>
  </div>

  <div>
    <div class="label">Date</div>
    <div class="value">${escapeHtml(
      detail.entry_date
    )}</div>
  </div>

  <div>
    <div class="label">Payment Method</div>
    <div class="value">${escapeHtml(
      detail.payment_mode || "—"
    )}</div>
  </div>

  <div>
    <div class="label">Cash / Bank Account</div>
    <div class="value">${escapeHtml(
      detail.account
    )}</div>
  </div>
</div>

${
  visibility.show_previous_balance
    ? `<div class="amount">
         <span>Previous Balance</span>
         <strong>Rs. ${money(
           Number(detail.balance_before || 0)
         )}</strong>
       </div>`
    : ""
}

<div class="amount">
  <span>${amountLabel}</span>
  <strong>Rs. ${money(detail.amount)}</strong>
</div>

${
  visibility.show_closing_balance
    ? `<div class="amount">
         <span>Closing Balance</span>
         <strong>Rs. ${money(
           Number(detail.balance_after || 0)
         )}</strong>
       </div>`
    : ""
}

${
  detail.description
    ? `<div class="note">
         <strong>Description:</strong>
         ${escapeHtml(detail.description)}
       </div>`
    : ""
}
</body>
</html>`);

      popup.document.close();
      popup.focus();

      setTimeout(() => {
        popup.print();
      }, 250);
    } catch (err: any) {
      setError(
        err?.message || "Failed to print voucher."
      );
    } finally {
      setWorkingId(null);
    }
  };

  const downloadPdf = async (voucher: Voucher) => {
    setWorkingId(voucher.id);
    setError(null);

    try {
      const [detail, visibility, company] =
        await Promise.all([
          getDetail(voucher),
          loadVisibility(),
          loadCompany(),
        ]);

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const companyName =
        company?.company_name ||
        company?.name ||
        "Company";

      const title =
        mode === "customer"
          ? "Receipt / Customer Receipt"
          : "Payment / Supplier Payment";

      pdf.setFontSize(18);
      pdf.text(companyName, 15, 18);

      pdf.setFontSize(15);
      pdf.text(title, 195, 18, {
        align: "right",
      });

      pdf.setFontSize(10);
      pdf.text(
        `Voucher: ${detail.entry_no}`,
        15,
        30
      );
      pdf.text(
        `${
          mode === "customer" ? "Customer" : "Supplier"
        }: ${detail.party_name || "—"}`,
        15,
        37
      );
      pdf.text(
        `Date: ${detail.entry_date}`,
        15,
        44
      );
      pdf.text(
        `Payment Method: ${
          detail.payment_mode || "—"
        }`,
        15,
        51
      );
      pdf.text(
        `Cash / Bank: ${detail.account}`,
        15,
        58
      );

      let y = 72;

      if (visibility.show_previous_balance) {
        pdf.setFontSize(11);
        pdf.text("Previous Balance", 18, y);
        pdf.setFontSize(15);
        pdf.text(
          `Rs. ${money(
            Number(detail.balance_before || 0)
          )}`,
          190,
          y,
          { align: "right" }
        );
        y += 15;
      }

      pdf.setFontSize(11);
      pdf.text(
        mode === "customer"
          ? "Amount Received"
          : "Amount Paid",
        18,
        y
      );
      pdf.setFontSize(15);
      pdf.text(
        `Rs. ${money(detail.amount)}`,
        190,
        y,
        { align: "right" }
      );
      y += 15;

      if (visibility.show_closing_balance) {
        pdf.setFontSize(11);
        pdf.text("Closing Balance", 18, y);
        pdf.setFontSize(15);
        pdf.text(
          `Rs. ${money(
            Number(detail.balance_after || 0)
          )}`,
          190,
          y,
          { align: "right" }
        );
        y += 15;
      }

      if (detail.description) {
        pdf.setFontSize(9);
        pdf.text(
          `Description: ${detail.description}`,
          18,
          y + 8,
          { maxWidth: 170 }
        );
      }

      pdf.save(
        `${detail.entry_no}-${
          mode === "customer"
            ? "Customer-Receipt"
            : "Supplier-Payment"
        }.pdf`
      );
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to generate voucher PDF."
      );
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="font-bold text-slate-900">
            {mode === "customer"
              ? "Posted Customer Receipt History"
              : "Posted Supplier Payment History"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Reprint or download previously posted vouchers</p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="btn-secondary inline-flex items-center gap-2 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading history...
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">
          No posted vouchers found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">
                  Voucher
                </th>
                <th className="px-4 py-3 text-left">
                  Date
                </th>
                <th className="px-4 py-3 text-left">
                  Party
                </th>
                <th className="px-4 py-3 text-right">
                  Previous
                </th>
                <th className="px-4 py-3 text-right">
                  Amount
                </th>
                <th className="px-4 py-3 text-right">
                  Closing
                </th>
                <th className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-bold text-slate-800">
                    {row.entry_no}
                  </td>
                  <td className="px-4 py-3">
                    {row.entry_date}
                  </td>
                  <td className="px-4 py-3">
                    {row.party_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    Rs.{" "}
                    {money(
                      Number(row.balance_before || 0)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    Rs.{" "}
                    {money(
                      Number(row.payment_amount || 0)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    Rs.{" "}
                    {money(
                      Number(row.balance_after || 0)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={workingId === row.id}
                        onClick={() =>
                          void printVoucher(row)
                        }
                        className="btn-secondary inline-flex items-center gap-1.5 text-xs"
                      >
                        {workingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Printer className="h-3.5 w-3.5" />
                        )}
                        Print
                      </button>

                      <button
                        type="button"
                        disabled={workingId === row.id}
                        onClick={() =>
                          void downloadPdf(row)
                        }
                        className="btn-secondary inline-flex items-center gap-1.5 text-xs"
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
