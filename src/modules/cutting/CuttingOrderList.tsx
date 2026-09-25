import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { CuttingOrder, Customer, Item } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import { PageHeader, Modal, ErrorBanner, StatusBadge, formatDate } from "@/components/ui";

export default function CuttingOrderList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CuttingOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ order_no: "", customer_id: "", item_id: "", cut_length: "", qty: "0", loading_qty: "0" });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cutting_orders")
      .select("*, customer:customers(*), item:items(*)")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  const fetchSupport = useCallback(async () => {
    const [c, i] = await Promise.all([
      supabase.from("customers").select("*").eq("is_active", true).order("name"),
      supabase.from("items").select("*").order("name"),
    ]);
    setCustomers(c.data ?? []);
    setItems(i.data ?? []);
  }, []);

  useEffect(() => { fetchRows(); fetchSupport(); }, [fetchRows, fetchSupport]);

  const openCreate = async () => {
    setError(null);
    const { data, error: numberError } = await supabase.rpc("next_cutting_order_no");
    if (numberError) { setError(numberError.message); return; }
    setForm({ order_no: String(data ?? ""), customer_id: "", item_id: "", cut_length: "", qty: "0", loading_qty: "0" });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      order_no: form.order_no,
      customer_id: form.customer_id || null,
      item_id: form.item_id || null,
      cut_length: form.cut_length || null,
      qty: parseFloat(form.qty) || 0,
      loading_qty: parseFloat(form.loading_qty) || 0,
      status: "pending" as const,
    };
    const { data, error } = await supabase.from("cutting_orders").insert(payload).select().single();
    if (error) { setError(error.message); return; }
    setModalOpen(false);
    setError(null);
    navigate(`/cutting/${data.id}`);
  };

  const columns: Column<CuttingOrder>[] = [
    { key: "order_no", label: "Order #", render: (r) => <span className="font-medium text-primary-600">{r.order_no}</span> },
    { key: "customer", label: "Customer", render: (r) => r.customer?.name ?? "—" },
    { key: "item", label: "Item", render: (r) => r.item?.name ?? "—" },
    { key: "cut_length", label: "Cut Length", render: (r) => r.cut_length ?? "—" },
    { key: "qty", label: "Qty (kg)" },
    { key: "loading_qty", label: "Loading Qty" },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "created_at", label: "Date", render: (r) => formatDate(r.created_at) },
    {
      key: "actions", label: "", className: "text-right",
      render: (r) => <button onClick={() => navigate(`/cutting/${r.id}`)} className="text-primary-600 hover:text-primary-700 text-sm font-medium">Open →</button>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Cutting & Loading"
        subtitle="Manage cutting and loading work orders"
        action={<button onClick={() => void openCreate()} className="btn-primary">+ New Cutting Order</button>}
      />
      {error && <ErrorBanner message={error} />}
      <div data-report-content data-navilo-customizable="true" className="contents"><DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No cutting orders yet." /></div>

      <Modal open={modalOpen} title="New Cutting Order" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="label">Order Number</label><input className="input bg-slate-50 cursor-not-allowed" required readOnly tabIndex={-1} value={form.order_no} title="Order number is generated automatically" /></div>
          <div>
            <label className="label">Customer</label>
            <SearchableSelect className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SearchableSelect>
          </div>
          <div>
            <label className="label">Item</label>
            <SearchableSelect className="input" value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
              <option value="">— Select item —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </SearchableSelect>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Cut Length</label><input className="input" value={form.cut_length} onChange={(e) => setForm({ ...form, cut_length: e.target.value })} placeholder="e.g. 12ft" /></div>
            <div><label className="label">Qty (kg)</label><input className="input" type="number" step="0.01" required value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></div>
          </div>
          <div><label className="label">Loading Qty</label><input className="input" type="number" step="0.01" value={form.loading_qty} onChange={(e) => setForm({ ...form, loading_qty: e.target.value })} /></div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create & Open</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
