import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { CuttingOrder, CuttingStatus } from "@/types";
import { PageHeader, ErrorBanner, StatusBadge, formatDate, ConfirmModal } from "@/components/ui";

export default function CuttingOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<CuttingOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from("cutting_orders")
      .select("*, customer:customers(*), item:items(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) { setError(error.message); return; }
    setOrder(data);
  }, [id]);

  useEffect(() => {
    (async () => {
      await fetchOrder();
      setLoading(false);
    })();
  }, [fetchOrder]);

  const handleStatusChange = async (status: CuttingStatus) => {
    if (!order) return;
    const { error } = await supabase.from("cutting_orders").update({ status }).eq("id", order.id);
    if (error) { setError(error.message); return; }
    setOrder({ ...order, status });
  };

  const handleDelete = async () => {
    if (!order) return;
    const { error } = await supabase.from("cutting_orders").delete().eq("id", order.id);
    if (error) { setError(error.message); return; }
    navigate("/cutting");
  };

  if (loading) return <div className="card p-12 text-center text-slate-400">Loading……</div>;
  if (!order) return <ErrorBanner message="Cutting order not found." />;

  const statusOptions: CuttingStatus[] = ["pending", "in_progress", "completed", "closed"];

  return (
    <div>
      <Link to="/cutting" className="text-sm text-primary-600 hover:text-primary-700 mb-4 inline-block">← Back to Cutting Orders</Link>
      <PageHeader
        title={order.order_no}
        subtitle={order.customer ? `Customer: ${order.customer.name}` : "No customer"}
        action={
          <div className="flex items-center gap-3">
            <SearchableSelect className="input w-auto" value={order.status} onChange={(e) => handleStatusChange(e.target.value as CuttingStatus)}>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </SearchableSelect>
            <button onClick={() => setConfirmDelete(true)} className="btn-danger">Delete</button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card p-4"><div className="text-sm text-slate-500">Date</div><div className="font-medium mt-1">{formatDate(order.created_at)}</div></div>
        <div className="card p-4"><div className="text-sm text-slate-500">Status</div><div className="mt-1"><StatusBadge status={order.status} /></div></div>
        <div className="card p-4"><div className="text-sm text-slate-500">Item</div><div className="font-medium mt-1">{order.item?.name ?? "—"}</div></div>
        <div className="card p-4"><div className="text-sm text-slate-500">Cut Length</div><div className="font-medium mt-1">{order.cut_length ?? "—"}</div></div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="card p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Order Details</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-slate-500">Quantity (kg)::</span> <span className="font-medium">{order.qty}</span></div>
          <div><span className="text-slate-500">Loading Qty::</span> <span className="font-medium">{order.loading_qty}</span></div>
        </div>
      </div>

      <ConfirmModal open={confirmDelete} title="Delete Cutting Order" message="Delete this cutting order permanently?" onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
