import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { WorkOrder, Item } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import {
  PageHeader,
  Modal,
  ErrorBanner,
  StatusBadge,
  formatDate,
} from "@/components/ui";

type WorkOrderRow = WorkOrder & {
  warehouse_id?: string | null;
  godown_id?: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
};

type GodownOption = {
  id: string;
  name: string;
  warehouse_id: string;
};

const EMPTY_FORM = {
  order_no: "",
  item_id: "",
  qty: "1",
  warehouse_id: "",
  godown_id: "",
  start_date: "",
  end_date: "",
};

export default function WorkOrderList() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [godowns, setGodowns] = useState<GodownOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchRows = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("work_orders")
      .select("*, item:items(*)")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as WorkOrderRow[]);
    }

    setLoading(false);
  }, []);

  const fetchMasterData = useCallback(async () => {
    const [itemsRes, warehousesRes, godownsRes] = await Promise.all([
      supabase
        .from("items")
        .select("*")
        .eq("type", "finished")
        .order("name"),

      supabase
        .from("warehouses")
        .select("id,name")
        .order("name"),

      supabase
        .from("godowns")
        .select("id,name,warehouse_id")
        .order("name"),
    ]);

    if (itemsRes.error) {
      setError(itemsRes.error.message);
    } else {
      setItems((itemsRes.data ?? []) as Item[]);
    }

    if (warehousesRes.error) {
      setError(warehousesRes.error.message);
    } else {
      setWarehouses((warehousesRes.data ?? []) as WarehouseOption[]);
    }

    if (godownsRes.error) {
      setError(godownsRes.error.message);
    } else {
      setGodowns((godownsRes.data ?? []) as GodownOption[]);
    }
  }, []);

  useEffect(() => {
    void Promise.all([fetchRows(), fetchMasterData()]);
  }, [fetchRows, fetchMasterData]);

  const modalGodowns = useMemo(
    () => godowns.filter((g) => g.warehouse_id === form.warehouse_id),
    [godowns, form.warehouse_id]
  );

  const openCreate = async () => {
    setError(null);

    const warehouseId = warehouses[0]?.id ?? "";
    const godownId =
      godowns.find((g) => g.warehouse_id === warehouseId)?.id ?? "";

    const { data, error: numberError } = await supabase.rpc(
      "next_work_order_no"
    );

    if (numberError) {
      setError(numberError.message);
      return;
    }

    setForm({
      ...EMPTY_FORM,
      order_no: String(data ?? ""),
      warehouse_id: warehouseId,
      godown_id: godownId,
    });

    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const qty = Number(form.qty);

    if (!form.order_no.trim()) {
      return setError("Work order number is required.");
    }

    if (!form.item_id) {
      return setError("Select a finished product.");
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      return setError("Production quantity must be greater than zero.");
    }

    if (!form.warehouse_id) {
      return setError("Select a warehouse.");
    }

    if (!form.godown_id) {
      return setError("Select a godown.");
    }

    const selectedGodown = godowns.find((g) => g.id === form.godown_id);

    if (
      !selectedGodown ||
      selectedGodown.warehouse_id !== form.warehouse_id
    ) {
      return setError(
        "Selected godown does not belong to selected warehouse."
      );
    }

    setSaving(true);

    try {
      const { data, error } = await supabase
        .from("work_orders")
        .insert({
          order_no: form.order_no.trim().toUpperCase(),
          item_id: form.item_id,
          qty: Number(qty.toFixed(3)),
          warehouse_id: form.warehouse_id,
          godown_id: form.godown_id,
          status: "planned",
          start_date: form.start_date || null,
          end_date: form.end_date || null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error(
            "This work order number already exists. Close and create again."
          );
        }

        throw error;
      }

      setModalOpen(false);
      setForm(EMPTY_FORM);
      navigate(`/production/${data.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to create work order.");
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<WorkOrderRow>[] = [
    {
      key: "order_no",
      label: "Order #",
      render: (r) => (
        <span className="font-medium text-primary-600">{r.order_no}</span>
      ),
    },
    {
      key: "item",
      label: "Product",
      render: (r) => r.item?.name ?? "—",
    },
    {
      key: "qty",
      label: "Qty",
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "start_date",
      label: "Start",
      render: (r) => (r.start_date ? formatDate(r.start_date) : "—"),
    },
    {
      key: "end_date",
      label: "End",
      render: (r) => (r.end_date ? formatDate(r.end_date) : "—"),
    },
    {
      key: "actions",
      label: "",
      className: "text-right",
      render: (r) => (
        <button
          type="button"
          onClick={() => navigate(`/production/${r.id}`)}
          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
        >
          Open →
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Work Orders"
        subtitle="Manage production orders"
        action={
          <button
            type="button"
            onClick={() => void openCreate()}
            className="btn-primary"
          >
            + New Work Order
          </button>
        }
      />

      {error && <ErrorBanner message={error} />}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        emptyMessage="No work orders yet."
      />

      <Modal
        open={modalOpen}
        title="New Work Order"
        onClose={() => {
          if (!saving) {
            setModalOpen(false);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Order Number</label>
            <input
              className="input bg-slate-50"
              value={form.order_no}
              readOnly
            />
          </div>

          <div>
            <label className="label">Product (Finished Good)</label>
            <SearchableSelect
              className="input"
              required
              value={form.item_id}
              onChange={(e) =>
                setForm({ ...form, item_id: e.target.value })
              }
            >
              <option value="">— Select product —</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SearchableSelect>
          </div>

          <div>
            <label className="label">Production Quantity</label>
            <input
              className="input"
              type="number"
              min="0.001"
              step="0.001"
              required
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Warehouse</label>
              <SearchableSelect
                className="input"
                required
                value={form.warehouse_id}
                onChange={(e) => {
                  const warehouseId = e.target.value;
                  const firstGodown =
                    godowns.find(
                      (g) => g.warehouse_id === warehouseId
                    )?.id ?? "";

                  setForm({
                    ...form,
                    warehouse_id: warehouseId,
                    godown_id: firstGodown,
                  });
                }}
              >
                <option value="">— Select warehouse —</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </SearchableSelect>
            </div>

            <div>
              <label className="label">Godown</label>
              <SearchableSelect
                className="input"
                required
                value={form.godown_id}
                onChange={(e) =>
                  setForm({ ...form, godown_id: e.target.value })
                }
              >
                <option value="">— Select godown —</option>
                {modalGodowns.map((godown) => (
                  <option key={godown.id} value={godown.id}>
                    {godown.name}
                  </option>
                ))}
              </SearchableSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Start Date</label>
              <input
                className="input"
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
              />
            </div>

            <div>
              <label className="label">Planned End Date</label>
              <input
                className="input"
                type="date"
                value={form.end_date}
                onChange={(e) =>
                  setForm({ ...form, end_date: e.target.value })
                }
              />
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setModalOpen(false);
                setForm(EMPTY_FORM);
              }}
              className="btn-secondary"
            >Cancel</button>

            <button
              type="submit"
              disabled={saving}
              className="btn-primary"
            >
              {saving ? "Creating..." : "Create & Open"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
