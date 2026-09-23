import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { FurnaceYield as FurnaceYieldType } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import { PageHeader, Modal, ErrorBanner, ConfirmModal, formatDate } from "@/components/ui";

export default function FurnaceYield() {
  const [rows, setRows] = useState<FurnaceYieldType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FurnaceYieldType | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    heat_no: "",
    furnace_no: "",
    charge_weight: "0",
    output_weight: "0",
    yield_date: new Date().toISOString().slice(0, 10),
  });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("furnace_yields").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const calcYield = () => {
    const charge = parseFloat(form.charge_weight) || 0;
    const output = parseFloat(form.output_weight) || 0;
    if (charge === 0) return "0";
    return ((output / charge) * 100).toFixed(2);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ heat_no: "", furnace_no: "", charge_weight: "0", output_weight: "0", yield_date: new Date().toISOString().slice(0, 10) });
    setModalOpen(true);
  };

  const openEdit = (row: FurnaceYieldType) => {
    setEditing(row);
    setForm({
      heat_no: row.heat_no,
      furnace_no: row.furnace_no ?? "",
      charge_weight: String(row.charge_weight),
      output_weight: String(row.output_weight),
      yield_date: row.yield_date,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const charge = parseFloat(form.charge_weight) || 0;
    const output = parseFloat(form.output_weight) || 0;
    const yieldPct = charge > 0 ? (output / charge) * 100 : 0;
    const payload = {
      heat_no: form.heat_no,
      furnace_no: form.furnace_no || null,
      charge_weight: charge,
      output_weight: output,
      yield_pct: yieldPct,
      yield_date: form.yield_date,
    };
    if (editing) {
      const { error } = await supabase.from("furnace_yields").update(payload).eq("id", editing.id);
      if (error) { setError(error.message); return; }
    } else {
      const { error } = await supabase.from("furnace_yields").insert(payload);
      if (error) { setError(error.message); return; }
    }
    setModalOpen(false);
    setError(null);
    fetchRows();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("furnace_yields").delete().eq("id", deleteId);
    if (error) setError(error.message);
    setDeleteId(null);
    fetchRows();
  };

  const columns: Column<FurnaceYieldType>[] = [
    { key: "heat_no", label: "Heat #", render: (r) => <span className="font-medium text-primary-600">{r.heat_no}</span> },
    { key: "furnace_no", label: "Furnace #", render: (r) => r.furnace_no ?? "—" },
    { key: "yield_date", label: "Date", render: (r) => formatDate(r.yield_date) },
    { key: "charge_weight", label: "Charge (kg)", render: (r) => r.charge_weight.toLocaleString() },
    { key: "output_weight", label: "Output (kg)", render: (r) => r.output_weight.toLocaleString() },
    { key: "yield_pct", label: "Yield %", render: (r) => (
      <span className={`font-medium ${r.yield_pct >= 90 ? "text-success-600" : r.yield_pct >= 80 ? "text-warning-600" : "text-error-600"}`}>
        {r.yield_pct}%
      </span>
    )},
    {
      key: "actions", label: "", className: "text-right",
      render: (r) => (
        <div className="flex gap-2 justify-end">
          <button onClick={() => openEdit(r)} className="text-primary-600 hover:text-primary-700 text-sm font-medium">Edit</button>
          <button onClick={() => setDeleteId(r.id)} className="text-error-600 hover:text-error-700 text-sm font-medium">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Furnace Yield" subtitle="Track furnace heats and yield percentages" action={<button onClick={openCreate} className="btn-primary">+ New Heat</button>} />
      {error && <ErrorBanner message={error} />}
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No furnace yield records yet." />

      <Modal open={modalOpen} title={editing ? "Edit Heat Record" : "New Heat Record"} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Heat Number</label><input className="input" required value={form.heat_no} onChange={(e) => setForm({ ...form, heat_no: e.target.value })} /></div>
            <div><label className="label">Furnace Number</label><input className="input" value={form.furnace_no} onChange={(e) => setForm({ ...form, furnace_no: e.target.value })} /></div>
          </div>
          <div><label className="label">Date</label><input className="input" type="date" required value={form.yield_date} onChange={(e) => setForm({ ...form, yield_date: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Charge Weight (kg)</label><input className="input" type="number" step="0.01" required value={form.charge_weight} onChange={(e) => setForm({ ...form, charge_weight: e.target.value })} /></div>
            <div><label className="label">Output Weight (kg)</label><input className="input" type="number" step="0.01" required value={form.output_weight} onChange={(e) => setForm({ ...form, output_weight: e.target.value })} /></div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <span className="text-slate-500">Calculated Yield:</span>
            <span className="font-bold text-primary-600">{calcYield()}%</span>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editing ? "Save Changes" : "Create Record"}</button>
          </div>
        </form>
      </Modal>

      <ConfirmModal open={!!deleteId} title="Delete Heat Record" message="Delete this furnace yield record?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
