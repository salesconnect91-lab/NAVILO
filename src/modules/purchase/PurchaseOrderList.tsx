import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { PurchaseOrder } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import { PageHeader, ErrorBanner, StatusBadge, formatCurrency, formatDate } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";

type ImportRow = {
  invoice_no?: string;
  supplier?: string;
  invoice_date?: string;
  invoice_type?: string;
  item?: string;
  description?: string;
  godown?: string;
  qty?: string | number;
  unit_cost?: string | number;
  tax_percent?: string | number;
};

type ImportSupplier = { id: string; name: string };
type ImportItem = { id: string; name: string; sku?: string | null };
type ImportGodown = { id: string; name: string };

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
const importInvoiceType = (value: unknown) => {
  const v = normalize(value);
  return v === "with tax" || v === "tax invoice" || v === "with-tax" ? "Tax Invoice" : "Purchase Invoice";
};

export default function PurchaseOrderList() {
  const navigate = useNavigate();
  const { activeCompany, isPlatformOwner } = useAuth();
  const canCreate = canPerformModule(activeCompany?.membership_role, "purchase", "create", activeCompany?.permissions, isPlatformOwner);
  const canDelete = canPerformModule(activeCompany?.membership_role, "purchase", "delete", activeCompany?.permissions, isPlatformOwner);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("purchase_orders")
      .select("*, supplier:suppliers(*)")
      .order("created_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  const downloadTemplate = () => {
    const csv = [
      "invoice_no,supplier,invoice_date,invoice_type,item,description,godown,qty,unit_cost,tax_percent",
      "PO-1001,ABC Steel,2026-09-14,Without Tax,Steel Bar,,Godown No. 2,10,1000,0",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase_invoice_import_template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);

    Papa.parse<ImportRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const createdOrderIds: string[] = [];
        try {
          if (!data.length) throw new Error("Import file is empty.");

          const [supplierRes, itemRes, godownRes] = await Promise.all([
            supabase.from("suppliers").select("id,name").eq("is_active", true),
            supabase.from("items").select("id,name,sku").eq("is_active", true),
            supabase.from("godowns").select("id,name"),
          ]);
          const firstError = [supplierRes.error, itemRes.error, godownRes.error].find(Boolean);
          if (firstError) throw firstError;

          const suppliers = (supplierRes.data ?? []) as ImportSupplier[];
          const items = (itemRes.data ?? []) as ImportItem[];
          const godowns = (godownRes.data ?? []) as ImportGodown[];
          const grouped = new Map<string, ImportRow[]>();

          data.forEach((row, index) => {
            const invoiceNo = String(row.invoice_no ?? "").trim();
            if (!invoiceNo) throw new Error(`Row ${index + 2}: invoice_no is required.`);
            grouped.set(invoiceNo, [...(grouped.get(invoiceNo) ?? []), row]);
          });

          for (const [invoiceNo, invoiceRows] of grouped) {
            const first = invoiceRows[0];
            const supplierName = String(first.supplier ?? "").trim();
            const supplier = suppliers.find((s) => normalize(s.name) === normalize(supplierName));
            if (!supplier) throw new Error(`${invoiceNo}: supplier "${supplierName}" not found.`);

            const orderDate = String(first.invoice_date ?? "").trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) throw new Error(`${invoiceNo}: invoice_date must be YYYY-MM-DD.`);
            const invoiceType = importInvoiceType(first.invoice_type);

            const preparedLines = invoiceRows.map((row, index) => {
              if (normalize(row.supplier) !== normalize(supplierName)) throw new Error(`${invoiceNo}: all rows must use the same supplier.`);
              if (String(row.invoice_date ?? "").trim() !== orderDate) throw new Error(`${invoiceNo}: all rows must use the same invoice_date.`);
              if (importInvoiceType(row.invoice_type) !== invoiceType) throw new Error(`${invoiceNo}: all rows must use the same invoice_type.`);

              const itemKey = normalize(row.item);
              const item = items.find((i) => normalize(i.name) === itemKey || normalize(i.sku) === itemKey);
              if (!item) throw new Error(`${invoiceNo} row ${index + 2}: item "${row.item ?? ""}" not found.`);

              const godownName = String(row.godown ?? "").trim();
              const godown = godowns.find((g) => normalize(g.name) === normalize(godownName));
              if (!godown) throw new Error(`${invoiceNo} row ${index + 2}: godown "${godownName}" not found.`);

              const qty = Number(row.qty);
              const unitCost = Number(row.unit_cost);
              const taxPercent = invoiceType === "Tax Invoice" ? Math.max(0, Number(row.tax_percent) || 0) : 0;
              if (!(qty > 0)) throw new Error(`${invoiceNo} row ${index + 2}: qty must be greater than zero.`);
              if (!(unitCost >= 0)) throw new Error(`${invoiceNo} row ${index + 2}: unit_cost is invalid.`);

              const lineTotal = qty * unitCost;
              return {
                item_id: item.id,
                godown_id: godown.id,
                qty,
                unit_cost: unitCost,
                tax_percent: taxPercent,
                description: String(row.description ?? "").trim() || null,
                line_total: lineTotal,
                total_with_tax: lineTotal + lineTotal * taxPercent / 100,
              };
            });

            const total = preparedLines.reduce((sum, line) => sum + line.total_with_tax, 0);
            const headerTax = invoiceType === "Tax Invoice"
              ? Math.max(...preparedLines.map((line) => line.tax_percent), 0)
              : 0;

            const { data: order, error: orderError } = await supabase
              .from("purchase_orders")
              .insert({
                order_no: invoiceNo,
                supplier_id: supplier.id,
                order_date: orderDate,
                status: "draft",
                invoice_type: invoiceType,
                tax_percent: headerTax,
                total: Number(total.toFixed(2)),
              })
              .select("id")
              .single();
            if (orderError) throw orderError;
            createdOrderIds.push(order.id);

            const { error: lineError } = await supabase.from("purchase_order_lines").insert(
              preparedLines.map(({ total_with_tax: _ignored, ...line }) => ({ ...line, order_id: order.id })),
            );
            if (lineError) throw lineError;
          }

          await fetchRows();
          alert(`Successfully imported ${grouped.size} purchase invoice${grouped.size === 1 ? "" : "s"} as draft.`);
        } catch (err: any) {
          if (createdOrderIds.length) {
            await supabase.from("purchase_order_lines").delete().in("order_id", createdOrderIds);
            await supabase.from("purchase_orders").delete().in("id", createdOrderIds).eq("status", "draft");
          }
          setError(err?.message || "Purchase invoice import failed.");
        } finally {
          setImporting(false);
          event.target.value = "";
        }
      },
      error: (parseError) => {
        setError(parseError.message || "Failed to parse CSV file.");
        setImporting(false);
        event.target.value = "";
      },
    });
  };

  const deleteDraft = async (row: PurchaseOrder) => {
    if (String(row.status).toLowerCase() !== "draft") return;
    if (!window.confirm(`Delete draft Purchase Invoice ${row.order_no}?`)) return;
    setError(null);
    const { data: deleted, error: deleteError } = await supabase.rpc("delete_draft_purchase_invoice", { p_order_id: row.id });
    if (deleteError) { setError(deleteError.message); return; }
    if (!deleted) { setError("Draft Purchase Invoice could not be deleted. Refresh and try again."); return; }
    await fetchRows();
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const invoiceType = row.invoice_type === "Tax Invoice" ? "with-tax" : "without-tax";
      const matchesSearch = !q || [row.order_no, row.supplier?.name ?? "", row.status ?? "", row.invoice_type ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
      const matchesType = typeFilter === "all" || typeFilter === invoiceType;
      const matchesStatus = statusFilter === "all" || String(row.status ?? "").toLowerCase() === statusFilter;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [rows, search, typeFilter, statusFilter]);

  const visiblePurchaseTotal = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    [filteredRows],
  );
  const visiblePostedTotal = useMemo(
    () => filteredRows.reduce((sum, row) => String(row.status ?? "").toLowerCase() === "posted" ? sum + (Number(row.total) || 0) : sum, 0),
    [filteredRows],
  );

  const columns: Column<PurchaseOrder>[] = [
    { key: "order_no", label: "Invoice #", render: (r) => <span className="font-medium text-primary-600">{r.order_no}</span> },
    { key: "supplier", label: "Supplier", render: (r) => r.supplier?.name ?? "—" },
    { key: "order_date", label: "Date", render: (r) => formatDate(r.order_date) },
    { key: "invoice_type", label: "Type", render: (r) => r.invoice_type === "Tax Invoice" ? "With Tax" : "Without Tax" },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "total", label: "Total", render: (r) => <span className="font-medium">{formatCurrency(r.total)}</span> },
    { key: "actions", label: "Actions", className: "text-right", render: (r) => {
      const isDraft = String(r.status ?? "").toLowerCase() === "draft";
      return <div className="flex justify-end gap-2">
        <button onClick={() => navigate(`/purchase/${r.id}`)} className="text-primary-600 hover:text-primary-700 text-sm font-medium">{isDraft ? "Edit" : "View"}</button>
        {isDraft && canDelete && <button onClick={() => void deleteDraft(r)} className="text-rose-600 hover:text-rose-700 text-sm font-medium">Delete</button>}
      </div>;
    } },
  ];

  return (
    <div>
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImport} />

      <PageHeader
        title="Purchase Invoices"
        subtitle="Manage supplier invoices, payment status, balances & posting"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <button
                onClick={() => navigate("/purchase/consolidated")}
                className="px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                📚 Consolidated Purchase
              </button>
            )}
            {canCreate && <button onClick={() => navigate("/purchase/new")} className="btn-primary">+ Main Purchase Invoice</button>}
            <span data-navilo-standard-tools-host className="contents" />

            {canCreate && <button type="button" onClick={downloadTemplate} className="btn-secondary">Download Template</button>}
            {canCreate && <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing} className="btn-secondary">{importing ? "Uploading..." : "Bulk Upload (CSV)"}</button>}
          </div>
        )}
      />

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_180px_180px]" data-no-export data-no-print>
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice, supplier or status…"
        />
        <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          <option value="without-tax">Without Tax</option>
          <option value="with-tax">With Tax</option>
        </select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Posting Statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}
      <div data-report-content data-navilo-customizable="true" className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="navilo-report-title text-base font-bold text-slate-900">Purchase Invoices</h2>
            {(search || typeFilter !== "all" || statusFilter !== "all") && (
              <p className="text-xs text-slate-500">
                Active filters: {search ? `Search “${search}” ` : ""}{typeFilter !== "all" ? `• ${typeFilter === "with-tax" ? "With Tax" : "Without Tax"} ` : ""}{statusFilter !== "all" ? `• ${statusFilter}` : ""}
              </p>
            )}
          </div>
        </div>

        <div className="mb-3 grid gap-3 md:grid-cols-3" data-no-export>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs text-slate-500">Visible Invoices</div>
            <div className="mt-2 text-sm font-bold text-slate-900">{filteredRows.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs text-slate-500">Purchase Total</div>
            <div className="mt-2 text-sm font-bold text-slate-900">{formatCurrency(visiblePurchaseTotal)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs text-slate-500">Posted Purchase Total</div>
            <div className="mt-2 text-sm font-bold text-slate-900">{formatCurrency(visiblePostedTotal)}</div>
          </div>
        </div>

        <DataTable columns={columns} rows={filteredRows} loading={loading} emptyMessage="No Main Purchase Invoices found." />
      </div>
    </div>
  );
}
