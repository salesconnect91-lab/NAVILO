import SearchableSelect from "@/components/SearchableSelect";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { SalesOrder, Customer, ChartOfAccount } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import {
  PageHeader,
  Modal,
  ErrorBanner,
  StatusBadge,
  formatCurrency,
  formatDate,
} from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";

type PaymentStatus = "unpaid" | "partial" | "paid" | "overpaid";

type SalesInvoiceRow = SalesOrder & {
  due_date?: string | null;
  paid_amount?: number | string | null;
  outstanding_amount?: number | string | null;
  payment_status?: PaymentStatus | null;
};

type AgingInvoice = {
  sales_order_id: string;
  user_id: string;
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  invoice_amount: number | string;
  paid_amount: number | string;
  outstanding_amount: number | string;
  payment_status: PaymentStatus;
  days_outstanding: number;
  overdue_days: number;
  aging_status: string;
  aging_bucket: string;
};

type AllocationState = Record<string, string>;

type ReceivePaymentResult = {
  success?: boolean;
  journal_entry_id?: string;
  entry_no?: string;
  customer_id?: string;
  customer_name?: string;
  payment_amount?: number;
  allocated_amount?: number;
};

const today = () => new Date().toISOString().slice(0, 10);

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const paymentStatusBadge = (status?: string | null) => {
  const normalized = (status || "unpaid").toLowerCase();

  const className =
    normalized === "paid"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : normalized === "partial"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : normalized === "overpaid"
          ? "bg-violet-100 text-violet-700 border-violet-200"
          : "bg-rose-100 text-rose-700 border-rose-200";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${className}`}
    >
      {normalized}
    </span>
  );
};

export default function SalesInvoiceList() {
  const navigate = useNavigate();
  const { activeCompany, isPlatformOwner } = useAuth();
  const canCreateSales = canPerformModule(activeCompany?.membership_role, "sales", "create", activeCompany?.permissions, isPlatformOwner);
  const canReceivePayment = canPerformModule(activeCompany?.membership_role, "accounting", "post", activeCompany?.permissions, isPlatformOwner);

  const [rows, setRows] = useState<SalesInvoiceRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<ChartOfAccount[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [listSearch, setListSearch] = useState("");
  const [postingFilter, setPostingFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentStatus>("all");

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);

  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [openInvoices, setOpenInvoices] = useState<AgingInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const [allocations, setAllocations] = useState<AllocationState>({});
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("sales_orders")
      .select("*, customer:customers(*)")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setRows((data ?? []) as SalesInvoiceRow[]);
    }

    setLoading(false);
  }, []);

  const fetchPaymentMasterData = useCallback(async () => {
    const [customersResult, accountsResult] = await Promise.all([
      supabase.from("customers").select("*").eq("is_active", true).order("name"),
      supabase
        .from("chart_of_accounts")
        .select("*")
        .eq("is_active", true)
        .eq("is_group", false)
        .eq("allow_manual_entries", true)
        .order("code"),
    ]);

    if (customersResult.error) {
      throw customersResult.error;
    }

    if (accountsResult.error) {
      throw accountsResult.error;
    }

    setCustomers((customersResult.data ?? []) as Customer[]);

    const allPostingAccounts = (accountsResult.data ?? []) as ChartOfAccount[];

    const preferredPaymentAccounts = allPostingAccounts.filter((account) => {
      const haystack = [
        account.code,
        account.name,
        account.detail_type || "",
      ]
        .join(" ")
        .toLowerCase();

      return (
        account.type === "asset" &&
        (haystack.includes("cash") || haystack.includes("bank"))
      );
    });

    setPaymentAccounts(
      preferredPaymentAccounts.length > 0
        ? preferredPaymentAccounts
        : allPostingAccounts.filter((account) => account.type === "asset")
    );
  }, []);

  useEffect(() => {
    fetchRows();

    fetchPaymentMasterData().catch((err: any) => {
      setError(err?.message || "Failed to load payment master data.");
    });
  }, [fetchRows, fetchPaymentMasterData]);

  const fetchOpenInvoices = useCallback(async (customerId: string) => {
    if (!customerId) {
      setOpenInvoices([]);
      return;
    }

    setLoadingInvoices(true);

    const { data, error } = await supabase
      .from("customer_invoice_aging")
      .select("*")
      .eq("customer_id", customerId)
      .gt("outstanding_amount", 0)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("invoice_date", { ascending: true });

    if (error) {
      setError(error.message);
      setOpenInvoices([]);
    } else {
      setOpenInvoices((data ?? []) as AgingInvoice[]);
    }

    setLoadingInvoices(false);
  }, []);

  const resetPaymentForm = useCallback(() => {
    setCustomerSearch("");
    setSelectedCustomerId("");
    setInvoiceSearch("");
    setOpenInvoices([]);
    setAllocations({});
    setPaymentAmount("");
    setPaymentDate(today());
    setPaymentAccountId("");
    setPaymentMethod("Cash");
    setReference("");
    setDescription("");
    setNotes("");
    setPaymentSuccess(null);
  }, []);

  const openReceivePayment = useCallback(
    async (customerId?: string | null) => {
      setError(null);
      setPaymentSuccess(null);
      setPaymentModalOpen(true);
      setAllocations({});
      setPaymentAmount("");
      setInvoiceSearch("");
      setPaymentDate(today());
      setReference("");
      setDescription("");
      setNotes("");

      if (customerId) {
        const customer = customers.find((c) => c.id === customerId);
        setSelectedCustomerId(customerId);
        setCustomerSearch(customer?.name || "");
        await fetchOpenInvoices(customerId);
      } else {
        setSelectedCustomerId("");
        setCustomerSearch("");
        setOpenInvoices([]);
      }
    },
    [customers, fetchOpenInvoices]
  );

  const closeReceivePayment = () => {
    if (paymentSaving) return;
    setPaymentModalOpen(false);
    resetPaymentForm();
  };

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();

    if (!q) return customers.slice(0, 50);

    return customers
      .filter((customer) => customer.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [customers, customerSearch]);

  const selectedCustomer = useMemo(
    () =>
      customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();

    if (!q) return openInvoices;

    return openInvoices.filter((invoice) =>
      [
        invoice.invoice_no,
        invoice.aging_status,
        invoice.aging_bucket,
        invoice.due_date || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [openInvoices, invoiceSearch]);

  const filteredRows = useMemo(() => {
    const q = listSearch.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !q ||
        [
          row.order_no,
          row.customer?.name || "",
          row.sales_person || "",
          row.order_date || "",
          row.due_date || "",
          row.status || "",
          row.payment_status || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesPosting =
        postingFilter === "all" || row.status === postingFilter;

      const matchesPayment =
        paymentFilter === "all" ||
        (row.payment_status || "unpaid") === paymentFilter;

      return matchesSearch && matchesPosting && matchesPayment;
    });
  }, [rows, listSearch, postingFilter, paymentFilter]);

  const filteredInvoiceTotal = useMemo(
    () => filteredRows.reduce((sum, row) => sum + toNumber(row.total), 0),
    [filteredRows]
  );

  const filteredBalanceDue = useMemo(
    () =>
      filteredRows.reduce(
        (sum, row) => sum + toNumber(row.outstanding_amount),
        0
      ),
    [filteredRows]
  );

  const allocatedTotal = useMemo(
    () =>
      Object.values(allocations).reduce(
        (sum, amount) => sum + Math.max(0, toNumber(amount)),
        0
      ),
    [allocations]
  );

  const selectedInvoiceCount = useMemo(
    () =>
      Object.values(allocations).filter((amount) => toNumber(amount) > 0).length,
    [allocations]
  );

  const unappliedAmount = Math.max(
    0,
    toNumber(paymentAmount) - allocatedTotal
  );

  const allocationDifference = toNumber(paymentAmount) - allocatedTotal;

  const selectCustomer = async (customer: Customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerSearch(customer.name);
    setAllocations({});
    setPaymentAmount("");
    await fetchOpenInvoices(customer.id);
  };

  const clearCustomer = () => {
    setSelectedCustomerId("");
    setCustomerSearch("");
    setOpenInvoices([]);
    setAllocations({});
    setPaymentAmount("");
    setInvoiceSearch("");
  };

  const setInvoiceAllocation = (invoice: AgingInvoice, rawValue: string) => {
    const outstanding = toNumber(invoice.outstanding_amount);

    if (rawValue === "") {
      setAllocations((prev) => ({
        ...prev,
        [invoice.sales_order_id]: "",
      }));
      return;
    }

    const parsed = Math.max(0, toNumber(rawValue));
    const capped = Math.min(parsed, outstanding);

    setAllocations((prev) => ({
      ...prev,
      [invoice.sales_order_id]: String(capped),
    }));
  };

  const toggleInvoiceFullAmount = (invoice: AgingInvoice) => {
    const current = toNumber(allocations[invoice.sales_order_id]);

    setAllocations((prev) => ({
      ...prev,
      [invoice.sales_order_id]:
        current > 0 ? "" : String(toNumber(invoice.outstanding_amount)),
    }));
  };

  const autoAllocate = () => {
    const receiptAmount = toNumber(paymentAmount);

    if (receiptAmount <= 0) {
      setError("Enter Amount Received first, then use Auto Allocate.");
      return;
    }

    let remaining = receiptAmount;
    const next: AllocationState = {};

    for (const invoice of openInvoices) {
      if (remaining <= 0) break;

      const outstanding = toNumber(invoice.outstanding_amount);
      const amount = Math.min(outstanding, remaining);

      if (amount > 0) {
        next[invoice.sales_order_id] = String(amount);
        remaining -= amount;
      }
    }

    setAllocations(next);
    setError(null);
  };

  const clearAllocations = () => {
    setAllocations({});
  };

  const handleReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPaymentSuccess(null);

    if (!selectedCustomerId) {
      setError("Select a customer.");
      return;
    }

    if (!paymentAccountId) {
      setError("Select a Cash / Bank account.");
      return;
    }

    const receiptAmount = toNumber(paymentAmount);

    if (receiptAmount <= 0) {
      setError("Amount Received must be greater than zero.");
      return;
    }

    const rpcAllocations = openInvoices
      .map((invoice) => ({
        sales_order_id: invoice.sales_order_id,
        amount: toNumber(allocations[invoice.sales_order_id]),
      }))
      .filter((allocation) => allocation.amount > 0);

    if (rpcAllocations.length === 0) {
      setError("Allocate the payment to at least one invoice.");
      return;
    }

    for (const allocation of rpcAllocations) {
      const invoice = openInvoices.find(
        (row) => row.sales_order_id === allocation.sales_order_id
      );

      if (!invoice) continue;

      if (allocation.amount > toNumber(invoice.outstanding_amount)) {
        setError(
          `Allocation for ${invoice.invoice_no} exceeds its outstanding balance.`
        );
        return;
      }
    }

    if (Math.abs(receiptAmount - allocatedTotal) > 0.005) {
      setError(
        `Amount Received (${formatCurrency(
          receiptAmount
        )}) must equal Allocated Amount (${formatCurrency(allocatedTotal)}).`
      );
      return;
    }

    setPaymentSaving(true);

    try {
      const { data, error } = await supabase.rpc("receive_customer_payment", {
        p_customer_id: selectedCustomerId,
        p_amount: receiptAmount,
        p_payment_date: paymentDate,
        p_payment_account_id: paymentAccountId,
        p_payment_method: paymentMethod,
        p_reference: reference || null,
        p_description: description || null,
        p_notes: notes || null,
        p_allocations: rpcAllocations,
      });

      if (error) throw error;

      const result = (data ?? {}) as ReceivePaymentResult;

      setPaymentSuccess(
        `Payment received successfully${
          result.entry_no ? ` — ${result.entry_no}` : ""
        }. Amount: ${formatCurrency(
          toNumber(result.payment_amount || receiptAmount)
        )}.`
      );

      await Promise.all([
        fetchRows(),
        fetchOpenInvoices(selectedCustomerId),
      ]);

      setAllocations({});
      setPaymentAmount("");
      setReference("");
      setDescription("");
      setNotes("");
    } catch (err: any) {
      setError(err?.message || "Failed to receive customer payment.");
    } finally {
      setPaymentSaving(false);
    }
  };

  const columns: Column<SalesInvoiceRow>[] = [
    {
      key: "order_no",
      label: "Invoice #",
      render: (r) => (
        <span className="font-semibold text-blue-600">{r.order_no}</span>
      ),
    },
    {
      key: "customer",
      label: "Customer",
      render: (r) => r.customer?.name ?? "—",
    },
    {
      key: "sales_person",
      label: "Sales Person",
      render: (r) => r.sales_person ?? "—",
    },
    {
      key: "order_date",
      label: "Invoice Date",
      render: (r) => formatDate(r.order_date),
    },
    {
      key: "due_date",
      label: "Due Date",
      render: (r) => (r.due_date ? formatDate(r.due_date) : "—"),
    },
    {
      key: "status",
      label: "Posting",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "payment_status",
      label: "Payment",
      render: (r) => paymentStatusBadge(r.payment_status),
    },
    {
      key: "total",
      label: "Invoice Amount",
      className: "text-right",
      render: (r) => (
        <span className="font-semibold text-slate-900">
          {formatCurrency(toNumber(r.total))}
        </span>
      ),
    },
    {
      key: "outstanding_amount",
      label: "Balance Due",
      className: "text-right",
      render: (r) => (
        <span
          className={
            toNumber(r.outstanding_amount) > 0
              ? "font-bold text-rose-700"
              : "font-semibold text-emerald-700"
          }
        >
          {formatCurrency(toNumber(r.outstanding_amount))}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      className: "text-right",
      render: (r) => (
        <div className="flex justify-end items-center gap-3">
          {canReceivePayment && r.customer_id && toNumber(r.outstanding_amount) > 0 && (
            <button
              onClick={() => openReceivePayment(r.customer_id)}
              className="text-emerald-700 hover:text-emerald-800 text-sm font-semibold"
            >
              Receive Payment
            </button>
          )}

          <button
            onClick={() => navigate(`/sales/${r.id}`)}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Open →
          </button>
        </div>
      ),
    },
  ];

  return (
    <div data-navilo-commercial-standard="true">

      <PageHeader
        title="Sales Invoices"
        subtitle="Customer invoices, receivables and posting"
        action={
          <div className="flex flex-wrap items-center gap-2" data-navilo-standard-tools-host>
{canReceivePayment && <button onClick={() => openReceivePayment()} className="px-3 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors">Receive Payment</button>}
{canCreateSales && <button
              onClick={() => navigate("/sales/new")}
              className="btn-primary"
            >
              New Invoice
            </button>}
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4" data-no-print data-no-export>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            className="input"
            value={listSearch}
            onChange={(event) => setListSearch(event.target.value)}
            placeholder="Search invoice, customer or sales person..."
          />

          <SearchableSelect
            className="input"
            value={postingFilter}
            onChange={(event) => setPostingFilter(event.target.value)}
          >
            <option value="all">All posting statuses</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
            <option value="cancelled">Cancelled</option>
          </SearchableSelect>

          <SearchableSelect
            className="input"
            value={paymentFilter}
            onChange={(event) => setPaymentFilter(event.target.value as "all" | PaymentStatus)}
          >
            <option value="all">All payment statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="overpaid">Overpaid</option>
          </SearchableSelect>
        </div>
      </div>

      <section data-report-content className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="navilo-report-title text-lg font-bold text-slate-900">Sales Invoices</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-500">Visible Invoices</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{filteredRows.length}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-500">Invoice Total</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(filteredInvoiceTotal)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-500">Balance Due</div>
              <div className="mt-1 text-lg font-bold text-rose-700">{formatCurrency(filteredBalanceDue)}</div>
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={filteredRows}
          loading={loading}
          emptyMessage="No invoices match the selected filters."
        />
      </section>

      <Modal
        open={paymentModalOpen}
        title="Receive Customer Payment"
        onClose={closeReceivePayment}
      >
        <form onSubmit={handleReceivePayment} className="space-y-5">
          {paymentSuccess && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {paymentSuccess}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 relative">
                <label className="label">Customer</label>

                <div className="relative">
                  <input
                    className="input pr-16"
                    placeholder="Search customer..."
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      if (selectedCustomerId) {
                        setSelectedCustomerId("");
                        setOpenInvoices([]);
                        setAllocations({});
                      }
                    }}
                    disabled={paymentSaving}
                  />

                  {(customerSearch || selectedCustomerId) && (
                    <button
                      type="button"
                      onClick={clearCustomer}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {!selectedCustomerId && customerSearch.trim() && (
                  <div className="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {filteredCustomers.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-slate-400">
                        No customer found.
                      </div>
                    ) : (
                      filteredCustomers.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => selectCustomer(customer)}
                          className="w-full px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                        >
                          <div className="text-sm font-semibold text-slate-900">
                            {customer.name}
                          </div>
                          <div className="text-[12px] text-slate-400">Customer</div>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {selectedCustomer && (
                  <div className="mt-1 text-xs text-emerald-700">
                    Selected: {selectedCustomer.name}
                  </div>
                )}
              </div>

              <div>
                <label className="label">Payment Date</label>
                <input
                  type="date"
                  className="input"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                  disabled={paymentSaving}
                />
              </div>

              <div>
                <label className="label">Payment Method</label>
                <SearchableSelect
                  className="input"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  disabled={paymentSaving}
                >
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Card">Card</option>
                  <option value="Other">Other</option>
                </SearchableSelect>
              </div>

              <div>
                <label className="label">Cash / Bank Account</label>
                <SearchableSelect
                  className="input"
                  value={paymentAccountId}
                  onChange={(e) => setPaymentAccountId(e.target.value)}
                  required
                  disabled={paymentSaving}
                >
                  <option value="">— Select account —</option>
                  {paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </SearchableSelect>
              </div>

              <div>
                <label className="label">Amount Received</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input text-right font-semibold"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  disabled={paymentSaving}
                />
              </div>

              <div>
                <label className="label">Reference No.</label>
                <input
                  className="input"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Cheque / bank / receipt reference"
                  disabled={paymentSaving}
                />
              </div>

              <div>
                <label className="label">Description</label>
                <input
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Payment description"
                  disabled={paymentSaving}
                />
              </div>

              <div className="md:col-span-2">
                <label className="label">Notes</label>
                <textarea
                  className="input min-h-[80px]"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional internal notes..."
                  disabled={paymentSaving}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-white border-b border-slate-200 p-4">
              <div className="flex flex-col md:flex-row md:items-end gap-3 justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">
                    Open / Partial Invoices
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select one or more invoices and allocate full or partial amounts.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    className="input text-sm w-56"
                    placeholder="Search invoice..."
                    value={invoiceSearch}
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    disabled={!selectedCustomerId || paymentSaving}
                  />

                  <button
                    type="button"
                    onClick={autoAllocate}
                    disabled={
                      !selectedCustomerId ||
                      toNumber(paymentAmount) <= 0 ||
                      paymentSaving
                    }
                    className="px-3 py-2 text-sm font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    Auto Allocate
                  </button>

                  <button
                    type="button"
                    onClick={clearAllocations}
                    disabled={paymentSaving}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Clear Allocation
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[360px]">
              <table className="w-full text-sm min-w-[1000px]">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-3 text-center font-medium">Select</th>
                    <th className="py-2.5 px-3 text-left font-medium">
                      Invoice #
                    </th>
                    <th className="py-2.5 px-3 text-left font-medium">
                      Invoice Date
                    </th>
                    <th className="py-2.5 px-3 text-left font-medium">
                      Due Date
                    </th>
                    <th className="py-2.5 px-3 text-right font-medium">
                      Invoice
                    </th>
                    <th className="py-2.5 px-3 text-right font-medium">
                      Paid
                    </th>
                    <th className="py-2.5 px-3 text-right font-medium">
                      Balance Due
                    </th>
                    <th className="py-2.5 px-3 text-left font-medium">
                      Aging
                    </th>
                    <th className="py-2.5 px-3 text-right font-medium">
                      Allocate
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {!selectedCustomerId ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-slate-400"
                      >
                        Search and select a customer to see open invoices.
                      </td>
                    </tr>
                  ) : loadingInvoices ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-slate-400"
                      >
                        Loading invoices...
                      </td>
                    </tr>
                  ) : filteredInvoices.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-slate-400"
                      >
                        No open invoices found for this customer.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((invoice) => {
                      const currentAllocation = toNumber(
                        allocations[invoice.sales_order_id]
                      );
                      const isSelected = currentAllocation > 0;
                      const overdue = Number(invoice.overdue_days) > 0;

                      return (
                        <tr
                          key={invoice.sales_order_id}
                          className={`border-b border-slate-100 ${
                            isSelected ? "bg-emerald-50/50" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleInvoiceFullAmount(invoice)}
                              disabled={paymentSaving}
                            />
                          </td>

                          <td className="py-2.5 px-3 font-semibold text-blue-700">
                            {invoice.invoice_no}
                          </td>

                          <td className="py-2.5 px-3 text-slate-600">
                            {formatDate(invoice.invoice_date)}
                          </td>

                          <td className="py-2.5 px-3 text-slate-600">
                            {invoice.due_date
                              ? formatDate(invoice.due_date)
                              : "—"}
                          </td>

                          <td className="py-2.5 px-3 text-right">
                            {formatCurrency(toNumber(invoice.invoice_amount))}
                          </td>

                          <td className="py-2.5 px-3 text-right text-emerald-700">
                            {formatCurrency(toNumber(invoice.paid_amount))}
                          </td>

                          <td className="py-2.5 px-3 text-right font-bold text-rose-700">
                            {formatCurrency(
                              toNumber(invoice.outstanding_amount)
                            )}
                          </td>

                          <td className="py-2.5 px-3">
                            {overdue ? (
                              <div>
                                <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                                  Overdue {invoice.overdue_days} days
                                </span>
                                <div className="text-[12px] text-slate-400 mt-1">
                                  {invoice.aging_bucket}
                                </div>
                              </div>
                            ) : (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                Current
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-3">
                            <input
                              type="number"
                              min="0"
                              max={toNumber(invoice.outstanding_amount)}
                              step="0.01"
                              className="input text-right min-w-[130px]"
                              value={
                                allocations[invoice.sales_order_id] ?? ""
                              }
                              onChange={(e) =>
                                setInvoiceAllocation(invoice, e.target.value)
                              }
                              placeholder="0.00"
                              disabled={paymentSaving}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Amount Received</div>
              <div className="mt-1 font-bold text-slate-900">
                {formatCurrency(toNumber(paymentAmount))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Allocated</div>
              <div className="mt-1 font-bold text-slate-900">
                {formatCurrency(allocatedTotal)}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Unapplied</div>
              <div
                className={`mt-1 font-bold ${
                  Math.abs(allocationDifference) < 0.005
                    ? "text-emerald-700"
                    : "text-amber-700"
                }`}
              >
                {formatCurrency(unappliedAmount)}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Invoices Selected</div>
              <div className="mt-1 font-bold text-slate-900">
                {selectedInvoiceCount}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeReceivePayment}
              className="btn-secondary"
              disabled={paymentSaving}
            >Close</button>

            <button
              type="submit"
              className="btn-primary"
              disabled={
                paymentSaving ||
                !selectedCustomerId ||
                !paymentAccountId ||
                toNumber(paymentAmount) <= 0 ||
                allocatedTotal <= 0 ||
                Math.abs(allocationDifference) > 0.005
              }
            >
              {paymentSaving
                ? "Posting Payment..."
                : `Receive & Post ${formatCurrency(allocatedTotal)}`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
