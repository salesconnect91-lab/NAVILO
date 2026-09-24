import SearchableSelect from "@/components/SearchableSelect";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import jsPDF from "jspdf";
import {
  documentContactText,
  documentOrientation,
  documentPageFormat,
  documentTaxText,
  loadDocumentPrintSettings,
} from "@/lib/documentPrintSettings";
import { useSearchParams } from "react-router-dom";
import { ErrorBanner, formatDate } from "@/components/ui";
import SupplierPaymentPanel from "./SupplierPaymentPanel";
import PaymentBalanceControls from "./PaymentBalanceControls";
import PaymentVoucherHistory from "./PaymentVoucherHistory";
import GeneralCashBankPanel from "./GeneralCashBankPanel";

type Customer = {
  id: string;
  name: string;
  phone?: string | null;
  account_id?: string | null;
};

type Invoice = {
  id: string;
  order_no: string;
  order_date: string;
  total: number;
  paid_amount: number;
  outstanding_amount: number;
  payment_status: string;
  customer_id: string | null;
};

type Account = {
  id: string;
  code: string;
  name: string;
};

type PaymentType = "invoice" | "advance";

type Receipt = {
  entry_no: string;
  journal_entry_id: string;
  customer_name: string;
  date: string;
  payment_method: string;
  account: string;
  amount: number;
  invoice_no?: string;  balance_before?: number;
  balance_after?: number;
};


const today = () =>
  new Date().toISOString().slice(0, 10);

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export default function CashCounter() {
  const [searchParams] = useSearchParams();
  const [counterMode, setCounterMode] = useState<"customer" | "supplier" | "general">("customer");
  const customerInputRef =
    useRef<HTMLInputElement>(null);

  const amountInputRef =
    useRef<HTMLInputElement>(null);

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [invoices, setInvoices] =
    useState<Invoice[]>([]);

  const [accounts, setAccounts] =
    useState<Account[]>([]);

  const [customerSearch, setCustomerSearch] =
    useState("");

  const [selectedCustomerId, setSelectedCustomerId] =
    useState("");

  const [selectedInvoiceId, setSelectedInvoiceId] =
    useState("");

  const [paymentType, setPaymentType] =
    useState<PaymentType>("invoice");

  const [paymentDate, setPaymentDate] =
    useState(today());

  const [paymentMethod, setPaymentMethod] =
    useState("Cash");

  const [paymentAccountId, setPaymentAccountId] =
    useState("");

  const [amount, setAmount] =
    useState("");

  const [allocation, setAllocation] =
    useState("");

  const [reference, setReference] =
    useState("");

  const [description, setDescription] =
    useState("");

  const [notes, setNotes] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [lastReceipt, setLastReceipt] =
    useState<Receipt | null>(null);

  const [recentPayments, setRecentPayments] =
    useState<any[]>([]);

  const loadMasterData = useCallback(
    async () => {
      setLoading(true);
      setError(null);

      const [
        customerResult,
        invoiceResult,
        accountResult,
      ] = await Promise.all([
        supabase
          .from("customers")
          .select("id,name,phone,account_id")
          .eq("is_active", true)
          .order("name"),

        supabase
          .from("sales_orders")
          .select(
            "id,order_no,order_date,total,paid_amount,outstanding_amount,payment_status,customer_id"
          )
          .gt("outstanding_amount", 0)
          .neq("payment_status", "paid")
          .order("order_date", {
            ascending: true,
          }),

        supabase
          .from("chart_of_accounts")
          .select("id,code,name")
          .eq("is_active", true)
          .eq("is_group", false)
          .eq("allow_manual_entries", true)
          .in("detail_type", ["Cash on Hand", "Bank Account"])
          .order("code"),
      ]);

      if (customerResult.error) {
        setError(customerResult.error.message);
      } else {
        setCustomers(
          (customerResult.data ??
            []) as Customer[]
        );
      }

      if (invoiceResult.error) {
        setError(invoiceResult.error.message);
      } else {
        setInvoices(
          (invoiceResult.data ?? []).map(
            (row: any) => ({
              ...row,
              total: toNumber(row.total),
              paid_amount: toNumber(
                row.paid_amount
              ),
              outstanding_amount: toNumber(
                row.outstanding_amount
              ),
            })
          ) as Invoice[]
        );
      }

      if (accountResult.error) {
        setError(accountResult.error.message);
      } else {
        setAccounts(
          (accountResult.data ??
            []) as Account[]
        );
      }

      setLoading(false);
    },
    []
  );

  const loadRecentPayments =
    useCallback(async () => {
      const { data } = await supabase
        .from("journal_entries")
        .select(
          "id,entry_no,entry_date,party_name,payment_mode,status"
        )
        .eq(
          "trans_type",
          "Customer Receipt"
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(10);

      setRecentPayments(data ?? []);
    }, []);

  useEffect(() => {
    void loadMasterData();
    void loadRecentPayments();
  }, [
    loadMasterData,
    loadRecentPayments,
  ]);

  useEffect(() => {
    const customerId = searchParams.get("customer_id");
    const invoiceId = searchParams.get("invoice_id");
    if (!customerId || !invoiceId || loading) return;
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;
    setSelectedCustomerId(customerId);
    setCustomerSearch(customer.name);
    setSelectedInvoiceId(invoiceId);
    const invoice = invoices.find((item) => item.id === invoiceId);
    if (invoice) {
      setAllocation(String(invoice.outstanding_amount));
      setAmount(String(invoice.outstanding_amount));
    }
  }, [searchParams, loading, customers, invoices]);

  const selectedCustomer =
    customers.find(
      (customer) =>
        customer.id ===
        selectedCustomerId
    ) ?? null;

  const customerInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) =>
          invoice.customer_id ===
            selectedCustomerId &&
          invoice.outstanding_amount > 0
      ),
    [invoices, selectedCustomerId]
  );

  const selectedInvoice =
    customerInvoices.find(
      (invoice) =>
        invoice.id ===
        selectedInvoiceId
    ) ?? null;

  const filteredCustomers = useMemo(() => {
    const q =
      customerSearch.trim().toLowerCase();

    if (!q) {
      return customers.slice(0, 12);
    }

    return customers
      .filter(
        (customer) =>
          customer.name
            .toLowerCase()
            .includes(q) ||
          customer.phone
            ?.toLowerCase()
            .includes(q)
      )
      .slice(0, 12);
  }, [customers, customerSearch]);

  const selectedAccount =
    accounts.find(
      (account) =>
        account.id ===
        paymentAccountId
    ) ?? null;

  const amountNumber =
    toNumber(amount);

  const allocationNumber =
    toNumber(allocation);

  const canPost =
    Boolean(selectedCustomerId) &&
    Boolean(paymentAccountId) &&
    amountNumber > 0 &&
    !saving &&
    (paymentType === "advance"
      ? true
      : Boolean(selectedInvoiceId) &&
        allocationNumber > 0 &&
        allocationNumber <=
          amountNumber + 0.005 &&
        allocationNumber <=
          toNumber(
            selectedInvoice
              ?.outstanding_amount
          ) + 0.005);

  const selectCustomer = (
    customer: Customer
  ) => {
    setSelectedCustomerId(
      customer.id
    );
    setCustomerSearch(
      customer.name
    );
    setSelectedInvoiceId("");
    setAllocation("");
    setSuccess(null);

    setTimeout(() => {
      if (paymentType === "invoice") {
        amountInputRef.current?.focus();
      } else {
        amountInputRef.current?.focus();
      }
    }, 50);
  };

  const selectInvoice = (
    invoiceId: string
  ) => {
    setSelectedInvoiceId(
      invoiceId
    );

    const invoice =
      customerInvoices.find(
        (item) =>
          item.id === invoiceId
      );

    if (invoice) {
      setAllocation(
        String(
          invoice.outstanding_amount
        )
      );
    }

    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 50);
  };

  const changePaymentType = (
    type: PaymentType
  ) => {
    setPaymentType(type);

    if (type === "advance") {
      setSelectedInvoiceId("");
      setAllocation("0");
    } else {
      setAllocation("");
    }

    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 50);
  };

  const resetEntry = () => {
    setSelectedCustomerId("");
    setSelectedInvoiceId("");
    setCustomerSearch("");
    setPaymentType("invoice");
    setAmount("");
    setAllocation("");
    setReference("");
    setDescription("");
    setNotes("");
    setSuccess(null);
    setLastReceipt(null);

    setTimeout(() => {
      customerInputRef.current?.focus();
    }, 50);
  };

  const printReceipt = async (
    receipt: Receipt
  ) => {
    try {
      const { company, visibility } =
        await loadDocumentPrintSettings(
          "receipt_payment"
        );

      const popup = window.open(
        "",
        "_blank",
        "width=900,height=1000"
      );

      if (!popup) {
        setError(
          "Please allow pop-ups to print the receipt."
        );
        return;
      }

      const invoiceText =
        receipt.invoice_no ||
        "Advance / Unapplied";

      const companyName =
        company.company_name ||
        "MetalForge OS";

      const contact =
        documentContactText(company);

      const taxText =
        documentTaxText(company);

      const size =
        documentPageFormat(
          company.page_size
        ) === "letter"
          ? "Letter"
          : "A4";

      const orientation =
        documentOrientation(
          company.page_orientation
        );

      const generatedAt =
        new Date().toLocaleString(
          "en-PK"
        );

      popup.document.write(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>
              Payment Receipt ${escapeHtml(
                receipt.entry_no
              )}
            </title>

            <style>
              * { box-sizing: border-box; }

              body {
                margin: 0;
                padding: 30px;
                background: #f3f4f6;
                font-family: Arial, Helvetica, sans-serif;
                color: #111827;
                font-size: 13px;
              }

              .sheet {
                width: 100%;
                max-width: 800px;
                margin: 0 auto;
                background: white;
                padding: 42px;
                border: 1px solid #e5e7eb;
              }

              .top {
                display: flex;
                justify-content: space-between;
                gap: 20px;
                border-bottom: 2px solid #111827;
                padding-bottom: 20px;
              }

              .brand {
                font-size: 26px;
                font-weight: 800;
              }

              .logo {
                max-height: 65px;
                max-width: 180px;
                object-fit: contain;
                margin-bottom: 8px;
              }

              .muted {
                color: #6b7280;
                margin-top: 5px;
              }

              .title {
                font-size: 22px;
                font-weight: 800;
                text-transform: uppercase;
              }

              .header-note {
                margin-top: 16px;
                padding: 10px 12px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
              }

              .grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin: 28px 0;
              }

              .label {
                color: #6b7280;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: .6px;
                font-weight: 700;
              }

              .value {
                margin-top: 5px;
                font-size: 14px;
                font-weight: 700;
              }

              .amount {
                margin: 24px 0;
                padding: 18px 20px;
                border: 1px solid #d1d5db;
                background: #f9fafb;
                display: flex;
                justify-content: space-between;
                align-items: center;
              }

              .amount strong {
                font-size: 25px;
              }

              table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 16px;
              }

              th {
                background: #f3f4f6;
                text-align: left;
                padding: 10px;
                font-size: 12px;
                text-transform: uppercase;
              }

              td {
                padding: 11px 10px;
                border-bottom: 1px solid #e5e7eb;
              }

              .right {
                text-align: right;
              }

              .footer {
                margin-top: 55px;
              }

              .signatures {
                display: flex;
                gap: 30px;
                justify-content: flex-end;
                margin-top: 55px;
              }

              .signature {
                width: 160px;
                border-top: 1px solid #9ca3af;
                text-align: center;
                padding-top: 8px;
                color: #6b7280;
                font-size: 12px;
              }

              .print-meta {
                margin-top: 25px;
                color: #94a3b8;
                font-size: 12px;
                display: flex;
                justify-content: space-between;
              }

              @media print {
                body {
                  padding: 0;
                  background: white;
                }

                .sheet {
                  border: 0;
                  max-width: none;
                }

                @page {
                  size: ${size} ${orientation};
                  margin: 10mm;
                }
              }
            </style>
          </head>

          <body>
            <div class="sheet">
              <div class="top">
                <div>
                  ${
                    visibility.show_logo &&
                    company.logo_url
                      ? `<img
                           class="logo"
                           src="${escapeHtml(
                             company.logo_url
                           )}"
                           alt="Company Logo"
                         />`
                      : ""
                  }

                  ${
                    visibility.show_company_name
                      ? `<div class="brand">
                           ${escapeHtml(
                             companyName
                           )}
                         </div>`
                      : ""
                  }

                  ${
                    visibility.show_address &&
                    company.address
                      ? `<div class="muted">
                           ${escapeHtml(
                             company.address
                           )}
                         </div>`
                      : ""
                  }

                  ${
                    visibility.show_phone_email &&
                    contact
                      ? `<div class="muted">
                           ${escapeHtml(contact)}
                         </div>`
                      : ""
                  }

                  ${
                    visibility.show_tax_details &&
                    taxText
                      ? `<div class="muted">
                           ${escapeHtml(taxText)}
                         </div>`
                      : ""
                  }
                </div>

                <div style="text-align:right">
                  <div class="title">
                    Receipt</div>
                  <div class="muted">
                    ${escapeHtml(
                      receipt.entry_no
                    )}
                  </div>
                </div>
              </div>

              ${
                visibility.show_header &&
                (
                  company.document_header ||
                  company.document_header_urdu
                )
                  ? `<div class="header-note">
                       ${
                         company.document_header
                           ? escapeHtml(
                               company.document_header
                             )
                           : ""
                       }
                       ${
                         company.document_header_urdu
                           ? `<div>
                                ${escapeHtml(
                                  company.document_header_urdu
                                )}
                              </div>`
                           : ""
                       }
                     </div>`
                  : ""
              }

              <div class="grid">
                <div>
                  <div class="label">
                    Received From</div>
                  <div class="value">
                    ${escapeHtml(
                      receipt.customer_name
                    )}
                  </div>
                </div>

                <div>
                  <div class="label">
                    Payment Date</div>
                  <div class="value">
                    ${escapeHtml(
                      receipt.date
                    )}
                  </div>
                </div>

                <div>
                  <div class="label">
                    Payment Method</div>
                  <div class="value">
                    ${escapeHtml(
                      receipt.payment_method
                    )}
                  </div>
                </div>

                <div>
                  <div class="label">
                    Cash / Bank Account
                  </div>
                  <div class="value">
                    ${escapeHtml(
                      receipt.account
                    )}
                  </div>
                </div>
              </div>

              ${
                visibility.show_previous_balance
                  ? `<div class="amount">
                       <span>Previous Balance</span>
                       <strong>Rs. ${money(receipt.balance_before ?? 0)}</strong>
                     </div>`
                  : ""
              }

              <div class="amount">
                <span>
                  Total Amount Received</span>

                <strong>
                  Rs. ${money(
                    receipt.amount
                  )}
                </strong>
              </div>
              ${
                visibility.show_closing_balance
                  ? `<div class="amount">
                       <span>Closing Balance</span>
                       <strong>Rs. ${money(receipt.balance_after ?? 0)}</strong>
                     </div>`
                  : ""
              }

              <table>
                <thead>
                  <tr>
                    <th>
                      Invoice / Purpose
                    </th>

                    <th class="right">
                      Amount</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td>
                      ${escapeHtml(
                        invoiceText
                      )}
                    </td>

                    <td class="right">
                      Rs. ${money(
                        receipt.amount
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>

              ${
                visibility.show_signatures
                  ? `<div class="signatures">
                       <div class="signature">
                         ${escapeHtml(
                           company.prepared_by_label ||
                           "Prepared By"
                         )}
                       </div>

                       <div class="signature">
                         ${escapeHtml(
                           company.approved_by_label ||
                           "Authorized Signature"
                         )}
                       </div>
                     </div>`
                  : ""
              }

              ${
                visibility.show_footer &&
                (
                  company.document_footer ||
                  company.document_footer_urdu
                )
                  ? `<div class="footer muted">
                       ${
                         company.document_footer
                           ? escapeHtml(
                               company.document_footer
                             )
                           : ""
                       }

                       ${
                         company.document_footer_urdu
                           ? `<div>
                                ${escapeHtml(
                                  company.document_footer_urdu
                                )}
                              </div>`
                           : ""
                       }
                     </div>`
                  : ""
              }

              ${
                visibility.show_print_datetime ||
                visibility.show_page_numbers
                  ? `<div class="print-meta">
                       <span>
                         ${
                           visibility.show_print_datetime
                             ? `Printed: ${escapeHtml(
                                 generatedAt
                               )}`
                             : ""
                         }
                       </span>

                       <span>
                         ${
                           visibility.show_page_numbers
                             ? "Page 1"
                             : ""
                         }
                       </span>
                     </div>`
                  : ""
              }
            </div>

            <script>
              window.onload = function() {
                window.focus();

                setTimeout(
                  function() {
                    window.print();
                  },
                  300
                );
              };
            </script>
          </body>
        </html>
      `);

      popup.document.close();
    } catch (err: any) {
      setError(
        err?.message ||
        "Failed to load receipt print settings."
      );
    }
  };

  const downloadReceiptPdf = async (
    receipt: Receipt
  ) => {
    try {
      const { company, visibility } =
        await loadDocumentPrintSettings(
          "receipt_payment"
        );

      const pdf = new jsPDF({
        orientation:
          documentOrientation(
            company.page_orientation
          ),
        unit: "mm",
        format:
          documentPageFormat(
            company.page_size
          ),
      });

      const pageWidth =
        pdf.internal.pageSize.getWidth();

      const pageHeight =
        pdf.internal.pageSize.getHeight();

      const margin = 16;
      let y = 18;

      if (visibility.show_company_name) {
        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(18);

        pdf.text(
          company.company_name ||
            "MetalForge OS",
          margin,
          y
        );

        y += 7;
      }

      if (
        visibility.show_address &&
        company.address
      ) {
        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(9);

        pdf.text(
          company.address,
          margin,
          y
        );

        y += 5;
      }

      const contact =
        documentContactText(company);

      if (
        visibility.show_phone_email &&
        contact
      ) {
        pdf.setFontSize(8);
        pdf.text(
          contact,
          margin,
          y
        );
        y += 5;
      }

      const tax =
        documentTaxText(company);

      if (
        visibility.show_tax_details &&
        tax
      ) {
        pdf.setFontSize(8);
        pdf.text(
          tax,
          margin,
          y
        );
        y += 5;
      }

      if (
        visibility.show_header &&
        company.document_header
      ) {
        y += 2;

        pdf.setFont(
          "helvetica",
          "bold"
        );

        pdf.setFontSize(9);

        pdf.text(
          company.document_header,
          margin,
          y
        );

        y += 7;
      }

      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.setFontSize(14);

      pdf.text(
        "CUSTOMER PAYMENT RECEIPT",
        margin,
        y
      );

      pdf.setFont(
        "helvetica",
        "normal"
      );

      pdf.setFontSize(9);

      pdf.text(
        receipt.entry_no,
        pageWidth - margin,
        y,
        { align: "right" }
      );

      y += 9;

      pdf.line(
        margin,
        y,
        pageWidth - margin,
        y
      );

      y += 10;

      const rows = [
        [
          "Customer",
          receipt.customer_name,
        ],
        [
          "Invoice / Purpose",
          receipt.invoice_no ||
            "Advance / Unapplied",
        ],
        [
          "Payment Date",
          receipt.date,
        ],
        [
          "Payment Method",
          receipt.payment_method,
        ],
        [
          "Cash / Bank Account",
          receipt.account,
        ],
      ];

      rows.forEach(
        ([label, value]) => {
          pdf.setFont(
            "helvetica",
            "bold"
          );

          pdf.text(
            label,
            margin,
            y
          );

          pdf.setFont(
            "helvetica",
            "normal"
          );

          pdf.text(
            String(value),
            margin + 45,
            y
          );

          y += 8;
        }
      );

      y += 4;

      pdf.setFont(
        "helvetica",
        "bold"
      );

      pdf.setFontSize(12);

      if (visibility.show_previous_balance) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text("Previous Balance", margin, y);
        pdf.text(
          `Rs. ${money(receipt.balance_before ?? 0)}`,
          pageWidth - margin,
          y,
          { align: "right" }
        );
        y += 8;
      }

      pdf.text(
        "Total Amount Received",
        margin,
        y
      );

      pdf.text(
        `Rs. ${money(
          receipt.amount
        )}`,
        pageWidth - margin,
        y,
        { align: "right" }
      );

      if (visibility.show_closing_balance) {
        y += 8;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text("Closing Balance", margin, y);
        pdf.text(
          `Rs. ${money(receipt.balance_after ?? 0)}`,
          pageWidth - margin,
          y,
          { align: "right" }
        );
      }

      if (
        visibility.show_signatures
      ) {
        y += 22;

        pdf.line(
          pageWidth -
            margin -
            55,
          y,
          pageWidth - margin,
          y
        );

        pdf.setFontSize(8);

        pdf.text(
          company.approved_by_label ||
            "Authorized Signature",
          pageWidth -
            margin -
            27.5,
          y + 5,
          { align: "center" }
        );
      }

      if (
        visibility.show_footer &&
        company.document_footer
      ) {
        pdf.setFont(
          "helvetica",
          "normal"
        );

        pdf.setFontSize(8);

        pdf.text(
          company.document_footer,
          margin,
          pageHeight - 15
        );
      }

      if (
        visibility.show_print_datetime
      ) {
        pdf.setFontSize(7);

        pdf.text(
          `Printed: ${new Date().toLocaleString(
            "en-PK"
          )}`,
          margin,
          pageHeight - 8
        );
      }

      if (
        visibility.show_page_numbers
      ) {
        pdf.setFontSize(7);

        pdf.text(
          "Page 1",
          pageWidth - margin,
          pageHeight - 8,
          { align: "right" }
        );
      }

      pdf.save(
        `${receipt.entry_no}-Customer-Receipt.pdf`
      );
    } catch (err: any) {
      setError(
        err?.message ||
        "Failed to generate receipt PDF."
      );
    }
  };

  const handlePost = async () => {
    setError(null);
    setSuccess(null);

    if (!selectedCustomer) {
      setError(
        "Select a customer first."
      );
      customerInputRef.current?.focus();
      return;
    }

    if (!paymentAccountId) {
      setError(
        "Select Payment Account."
      );
      return;
    }

    if (amountNumber <= 0) {
      setError(
        "Enter payment amount."
      );
      amountInputRef.current?.focus();
      return;
    }

    if (
      paymentType === "invoice" &&
      !selectedInvoice
    ) {
      setError(
        "Select an open invoice."
      );
      return;
    }

    if (
      paymentType === "invoice" &&
      allocationNumber <= 0
    ) {
      setError(
        "Enter allocation amount."
      );
      return;
    }

    if (
      paymentType === "invoice" &&
      allocationNumber >
        toNumber(
          selectedInvoice?.outstanding_amount
        ) +
          0.005
    ) {
      setError(
        "Allocation cannot exceed invoice outstanding balance."
      );
      return;
    }

    if (
      paymentType === "invoice" &&
      allocationNumber >
        amountNumber + 0.005
    ) {
      setError(
        "Allocation cannot exceed received amount."
      );
      return;
    }

    setSaving(true);

    try {
      const rpcAllocations =
        paymentType === "invoice"
          ? [
              {
                sales_order_id:
                  selectedInvoice!.id,
                amount:
                  allocationNumber,
              },
            ]
          : [];

      const { data, error: rpcError } =
        await supabase.rpc(
          "receive_customer_payment",
          {
            p_customer_id:
              selectedCustomer.id,
            p_amount: amountNumber,
            p_payment_date:
              paymentDate,
            p_payment_account_id:
              paymentAccountId,
            p_payment_method:
              paymentMethod,
            p_reference:
              reference.trim() || null,
            p_description:
              description.trim() ||
              (paymentType ===
              "advance"
                ? "Customer advance payment"
                : `Payment against ${selectedInvoice?.order_no}`),
            p_notes:
              notes.trim() || null,
            p_allocations:
              rpcAllocations,
          }
        );

      if (rpcError) {
        throw new Error(
          rpcError.message
        );
      }

      const result =
        (data ?? {}) as {
          success?: boolean;
          entry_no?: string;
          journal_entry_id?: string;
          payment_amount?: number;
          balance_before?: number;
          balance_after?: number;
          message?: string;
        };

      if (result.success === false) {
        throw new Error(
          result.message ||
            "Payment posting failed."
        );
      }

      let customerBalanceSnapshot: {
        balance_before: number | null;
        payment_amount: number | null;
        balance_after: number | null;
      } | null = null;

      if (result.journal_entry_id) {
        const { data: snapshotData, error: snapshotError } =
          await supabase
            .from("journal_entries")
            .select("balance_before,payment_amount,balance_after")
            .eq("id", result.journal_entry_id)
            .maybeSingle();

        if (snapshotError) throw snapshotError;
        customerBalanceSnapshot = snapshotData;
      }

      const receipt: Receipt = {
        entry_no:
          result.entry_no ||
          "Customer Receipt",
        journal_entry_id:
          result.journal_entry_id ||
          "",
        customer_name:
          selectedCustomer.name,
        date: formatDate(
          paymentDate
        ),
        payment_method:
          paymentMethod,
        account:
          selectedAccount?.name || "—",
        amount:
          toNumber(
            result.payment_amount ||
              amountNumber
          ),
        invoice_no:
          paymentType ===
          "invoice"
            ? selectedInvoice?.order_no
            : undefined,
        balance_before: toNumber(
          customerBalanceSnapshot?.balance_before ?? 0
        ),
        balance_after: toNumber(
          customerBalanceSnapshot?.balance_after ?? 0
        ),
      };

      setLastReceipt(receipt);

      setSuccess(
        `Payment received successfully — ${
          receipt.entry_no
        }. Amount: Rs. ${money(
          receipt.amount
        )}.`
      );

      await Promise.all([
        loadMasterData(),
        loadRecentPayments(),
      ]);

      setAmount("");
      setAllocation("");
      setReference("");
      setDescription("");
      setNotes("");
      setSelectedInvoiceId("");
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to receive customer payment."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (
    event: React.KeyboardEvent
  ) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      if (
        document.activeElement ===
        amountInputRef.current
      ) {
        void handlePost();
      }
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-sm text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading cash counter...
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-emerald-600" />
            <h1 className="text-2xl font-bold text-slate-900">
              Cash Counter
            </h1>
          </div>

          <p className="mt-1 text-sm text-slate-500">
            Fast customer receipt entry. One customer,
            one payment, one posting.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadMasterData();
            void loadRecentPayments();
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      {error && (
        <ErrorBanner message={error} />
      )}

      {success && (
        <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            {success}
          </div>

          {lastReceipt && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void printReceipt(lastReceipt)
                }
                className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
              >
                <Printer className="h-4 w-4" />
                Print Receipt</button>

              <button
                type="button"
                onClick={() =>
                  void downloadReceiptPdf(
                    lastReceipt
                  )
                }
                className="btn-secondary"
              >
                PDF Receipt</button>
            </div>
          )}
        </div>
      )}

      <div className="flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setCounterMode("customer")}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            counterMode === "customer"
              ? "bg-emerald-600 text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Customer Receipt</button>

        <button
          type="button"
          onClick={() => setCounterMode("supplier")}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            counterMode === "supplier"
              ? "bg-emerald-600 text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Supplier Payment</button>

        <button
          type="button"
          onClick={() => setCounterMode("general")}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            counterMode === "general"
              ? "bg-emerald-600 text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          General Cash / Bank</button>
      </div>

      {counterMode !== "general" && (
        <div className="mt-4">
          <PaymentBalanceControls />
        </div>
      )}

      {counterMode === "supplier" && <SupplierPaymentPanel />}

      {counterMode === "general" && <GeneralCashBankPanel />}

      <div
        className={`grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px] ${
          counterMode !== "customer" ? "hidden" : ""
        }`}
      >
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">
                  New Customer Receipt
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Press Enter in Amount to post quickly.
                </p>
              </div>

              <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                Data Entry
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) =>
                    setPaymentDate(
                      e.target.value
                    )
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Payment Method</label>
                <SearchableSelect
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(
                      e.target.value
                    )
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
                >
                  <option>Cash</option>
                  <option>Bank</option>
                  <option>Cheque</option>
                  <option>Online</option>
                  <option>Other</option>
                </SearchableSelect>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Payment Account</label>
                <SearchableSelect
                  value={paymentAccountId}
                  onChange={(e) =>
                    setPaymentAccountId(
                      e.target.value
                    )
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">
                    — Select payment account —
                  </option>
                  {accounts.map(
                    (account) => (
                      <option
                        key={account.id}
                        value={account.id}
                      >
                        {account.code} —{" "}
                        {account.name}
                      </option>
                    )
                  )}
                </SearchableSelect>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">Customer</label>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />

                <input
                  ref={
                    customerInputRef
                  }
                  value={
                    customerSearch
                  }
                  onChange={(e) => {
                    setCustomerSearch(
                      e.target.value
                    );

                    if (
                      selectedCustomerId
                    ) {
                      setSelectedCustomerId(
                        ""
                      );
                      setSelectedInvoiceId(
                        ""
                      );
                      setAllocation("");
                    }
                  }}
                  placeholder="Type customer name or phone......"
                  className="h-11 w-full rounded-lg border border-slate-200 pl-10 pr-10 text-sm font-medium outline-none focus:border-emerald-500"
                />

                <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />

                {!selectedCustomerId &&
                  customerSearch.trim() && (
                    <div className="absolute left-0 right-0 top-12 z-20 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {filteredCustomers.length ? (
                        filteredCustomers.map(
                          (customer) => (
                            <button
                              key={
                                customer.id
                              }
                              type="button"
                              onClick={() =>
                                selectCustomer(
                                  customer
                                )
                              }
                              className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-3 text-left hover:bg-emerald-50"
                            >
                              <span>
                                <span className="block text-sm font-semibold text-slate-900">
                                  {
                                    customer.name
                                  }
                                </span>
                                {customer.phone && (
                                  <span className="block text-[12px] text-slate-400">
                                    {
                                      customer.phone
                                    }
                                  </span>
                                )}
                              </span>

                              <span className="text-xs text-emerald-600">Select</span>
                            </button>
                          )
                        )
                      ) : (
                        <div className="px-3 py-4 text-xs text-slate-400">
                          No customer found.
                        </div>
                      )}
                    </div>
                  )}
              </div>

              {selectedCustomer && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <div>
                    <span className="text-slate-400">
                      Selected:
                    </span>{" "}
                    <strong className="text-slate-800">
                      {
                        selectedCustomer.name
                      }
                    </strong>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomerId(
                        ""
                      );
                      setCustomerSearch(
                        ""
                      );
                      setSelectedInvoiceId(
                        ""
                      );
                      setAllocation("");
                      customerInputRef.current?.focus();
                    }}
                    className="font-semibold text-red-600 hover:text-red-700"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() =>
                  changePaymentType(
                    "invoice"
                  )
                }
                className={`rounded-md px-4 py-2.5 text-sm font-bold transition ${
                  paymentType ===
                  "invoice"
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Invoice Payment
              </button>

              <button
                type="button"
                onClick={() =>
                  changePaymentType(
                    "advance"
                  )
                }
                className={`rounded-md px-4 py-2.5 text-sm font-bold transition ${
                  paymentType ===
                  "advance"
                    ? "bg-white text-amber-700 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Advance Payment
              </button>
            </div>

            {paymentType ===
              "invoice" && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Open Invoice
                </label>

                <SearchableSelect
                  value={
                    selectedInvoiceId
                  }
                  onChange={(e) =>
                    selectInvoice(
                      e.target.value
                    )
                  }
                  disabled={
                    !selectedCustomerId
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-emerald-500 disabled:bg-slate-100"
                >
                  <option value="">
                    {!selectedCustomerId
                      ? "Select customer first"
                      : "— Select open invoice —"}
                  </option>

                  {customerInvoices.map(
                    (invoice) => (
                      <option
                        key={invoice.id}
                        value={invoice.id}
                      >
                        {
                          invoice.order_no
                        }{" "}
                        — Outstanding Rs.{" "}
                        {money(
                          invoice.outstanding_amount
                        )}
                      </option>
                    )
                  )}
                </SearchableSelect>

                {selectedInvoice && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[12px] text-slate-400">
                        Invoice Total
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-slate-800">
                        Rs.{" "}
                        {money(
                          selectedInvoice.total
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[12px] text-slate-400">
                        Paid
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-slate-800">
                        Rs.{" "}
                        {money(
                          selectedInvoice.paid_amount
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg bg-amber-50 p-2.5">
                      <div className="text-[12px] text-amber-600">
                        Outstanding
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-amber-800">
                        Rs.{" "}
                        {money(
                          selectedInvoice.outstanding_amount
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Amount Received
                </label>

                <input
                  ref={
                    amountInputRef
                  }
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    const value =
                      e.target.value;

                    setAmount(value);

                    if (
                      paymentType ===
                      "invoice"
                    ) {
                      setAllocation(
                        value
                      );
                    }
                  }}
                  placeholder="0.00"
                  className="h-12 w-full rounded-lg border border-slate-300 px-3 text-right text-lg font-bold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  {paymentType ===
                  "invoice"
                    ? "Invoice Allocation"
                    : "Unapplied Advance"}
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    paymentType ===
                    "advance"
                      ? "0"
                      : allocation
                  }
                  onChange={(e) =>
                    setAllocation(
                      e.target.value
                    )
                  }
                  disabled={
                    paymentType ===
                    "advance"
                  }
                  className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-right text-lg font-bold outline-none disabled:text-slate-400"
                />
              </div>
            </div>

            {paymentType ===
              "advance" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <strong>
                  Advance payment:
                </strong>{" "}
                this amount has no invoice allocation.
                It will be kept as customer advance/unapplied
                balance after the advance-account backend step
                is enabled.
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Reference</label>
                <input
                  value={reference}
                  onChange={(e) =>
                    setReference(
                      e.target.value
                    )
                  }
                  placeholder="Receipt / cheque / reference"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">Description</label>
                <input
                  value={description}
                  onChange={(e) =>
                    setDescription(
                      e.target.value
                    )
                  }
                  placeholder="Optional"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Notes
                </label>
                <input
                  value={notes}
                  onChange={(e) =>
                    setNotes(
                      e.target.value
                    )
                  }
                  placeholder="Optional"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">
                    Amount to Post
                  </div>
                  <div className="mt-1 text-2xl font-extrabold text-slate-900">
                    Rs.{" "}
                    {money(
                      amountNumber
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400">
                    Allocation
                  </div>
                  <div className="mt-1 font-bold text-emerald-700">
                    Rs.{" "}
                    {money(
                      paymentType ===
                        "advance"
                        ? 0
                        : allocationNumber
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={resetEntry}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() =>
                  void handlePost()
                }
                disabled={
                  !canPost
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Posting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Receive &amp; Post
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-bold text-slate-900">
                  Recent Receipts
                </h3>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {recentPayments.length ? (
                recentPayments.map(
                  (payment) => (
                    <div
                      key={payment.id}
                      className="px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-800">
                            {
                              payment.party_name
                            }
                          </div>
                          <div className="mt-0.5 text-[12px] text-slate-400">
                            {
                              payment.entry_no
                            }{" "}
                            •{" "}
                            {formatDate(
                              payment.entry_date
                            )}
                          </div>
                        </div>

                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[12px] font-bold text-emerald-700">
                          Posted
                        </span>
                      </div>
                    </div>
                  )
                )
              ) : (
                <div className="px-4 py-8 text-center text-xs text-slate-400">
                  No receipts yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="text-xs leading-5 text-blue-900">
                <strong>Cashier workflow</strong>
                <br />
                Customer → Invoice / Advance →
                Amount → Receive &amp; Post → Print Receipt.
                <br />
                <br />
                The posting uses the existing
                <code className="mx-1 font-mono">
                  receive_customer_payment
                </code>
                accounting engine.
              </div>
            </div>
          </section>
        </aside>
      </div>

      {counterMode !== "general" && (
        <PaymentVoucherHistory mode={counterMode} />
      )}
    </div>
  );
}
