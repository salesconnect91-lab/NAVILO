import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, RefreshCw, Save, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, PageHeader, formatCurrency } from "@/components/ui";
import OrderBookExportToolbar from "@/components/OrderBookExportToolbar";
import OrderBookCustomerReport from "@/components/OrderBookCustomerReport";
import OrderBookCancelControl from "@/components/OrderBookCancelControl";
import OrderBookQtyAdjustControl from "@/components/OrderBookQtyAdjustControl";

type OrderType = "sales" | "purchase";
type Party = { id: string; name: string; name_urdu?: string | null };
type Item = { id: string; name: string; name_urdu?: string | null; unit?: string | null };
type Salesperson = { id: string; name: string };
type Commitment = {
  id: string;
  order_id: string;
  item_id: string;
  item_name: string;
  ordered_qty: number | string;
  fulfilled_qty: number | string;
  cancelled_qty: number | string;
  uom: string | null;
  rate_status: "agreed" | "pending";
  agreed_rate: number | string | null;
  effective_at: string | null;
  source: "order" | "spot" | "rate_revision";
  status: string;
  remarks: string | null;
};
type Header = {
  id: string;
  order_no: string;
  order_date: string;
  party_id: string;
  party_name: string;
  salesperson_id: string | null;
  salesperson_name: string | null;
  status: string;
  remarks: string | null;
  order_book_commitments: Commitment[];
};
type DraftLine = {
  item_id: string;
  qty: string;
  uom: string;
  rate_status: "agreed" | "pending";
  rate: string;
  effective_date: string;
  remarks: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): DraftLine => ({ item_id: "", qty: "", uom: "kg", rate_status: "pending", rate: "", effective_date: today(), remarks: "" });
const num = (value: unknown) => Number(value) || 0;

export default function OrderBook({ type }: { type: OrderType }) {
  const isSales = type === "sales";
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [orders, setOrders] = useState<Header[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "rate_pending" | "completed">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [partyId, setPartyId] = useState("");
  const [orderDate, setOrderDate] = useState(today());
  const [salespersonId, setSalespersonId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [rateTarget, setRateTarget] = useState<Commitment | null>(null);
  const [newRate, setNewRate] = useState("");
  const [rateDate, setRateDate] = useState(today());
  const [rateReason, setRateReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const partyTable = isSales ? "customers" : "suppliers";
      const [settingsRes, partyRes, itemRes, orderRes, salespersonRes] = await Promise.all([
        supabase.from("company_settings").select("order_book_enabled").maybeSingle(),
        supabase.from(partyTable).select("id,name,name_urdu").order("name"),
        supabase.from("items").select("id,name,name_urdu,unit").order("name"),
        supabase.from("order_book_headers").select("*,order_book_commitments(*)").eq("order_type", type).order("order_date", { ascending: false }).order("created_at", { ascending: false }),
        isSales ? supabase.from("employees").select("id,name").eq("is_active", true).order("name") : Promise.resolve({ data: [] as Salesperson[], error: null }),
      ]);
      const firstError = settingsRes.error || partyRes.error || itemRes.error || orderRes.error || salespersonRes.error;
      if (firstError) throw firstError;
      setEnabled(Boolean(settingsRes.data?.order_book_enabled));
      setParties((partyRes.data ?? []) as Party[]);
      setItems((itemRes.data ?? []) as Item[]);
      setSalespeople((salespersonRes.data ?? []) as Salesperson[]);
      setOrders(((orderRes.data ?? []) as unknown as Header[]).map((order) => ({ ...order, order_book_commitments: order.order_book_commitments ?? [] })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Order Book.");
    } finally {
      setLoading(false);
    }
  }, [isSales, type]);

  useEffect(() => { void load(); }, [load]);

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      const commitments = order.order_book_commitments;
      const matchesSearch = !q || [order.order_no, order.order_date, order.party_name, order.salesperson_name, ...commitments.map((c) => c.item_name)].some((value) => String(value ?? "").toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (filter === "completed") return order.status === "completed" || commitments.every((c) => c.status === "completed" || c.status === "cancelled");
      if (filter === "rate_pending") return commitments.some((c) => c.rate_status === "pending" && c.status !== "cancelled" && c.status !== "completed");
      if (filter === "open") return commitments.some((c) => Math.max(0, num(c.ordered_qty) - num(c.fulfilled_qty) - num(c.cancelled_qty)) > 0 && c.status !== "cancelled");
      return true;
    });
  }, [orders, search, filter]);

  const totals = useMemo(() => {
    const commitmentRows = visibleOrders.flatMap((order) => order.order_book_commitments.map((commitment) => ({ order, commitment })));
    return commitmentRows.reduce((acc, { order, commitment }) => {
      acc.orders.add(order.id);
      const balance = Math.max(0, num(commitment.ordered_qty) - num(commitment.fulfilled_qty) - num(commitment.cancelled_qty));
      acc.ordered += num(commitment.ordered_qty);
      acc.fulfilled += num(commitment.fulfilled_qty);
      acc.cancelled += num(commitment.cancelled_qty);
      acc.balance += balance;
      if (commitment.rate_status === "pending") acc.pendingQty += balance;
      else acc.openValue += balance * num(commitment.agreed_rate);
      return acc;
    }, { orders: new Set<string>(), ordered: 0, fulfilled: 0, cancelled: 0, balance: 0, pendingQty: 0, openValue: 0 });
  }, [visibleOrders]);

  const updateLine = (index: number, field: keyof DraftLine, value: string) => {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, [field]: value };
      if (field === "item_id") next.uom = items.find((item) => item.id === value)?.unit || next.uom || "kg";
      return next;
    }));
  };

  const createOrder = async () => {
    setError(null);
    if (!partyId) return setError(isSales ? "Select customer" : "Select supplier");
    if (isSales && !salespersonId) return setError("Select salesperson");
    const validLines = lines.filter((line) => line.item_id && num(line.qty) > 0);
    if (!validLines.length) return setError("Add at least one valid item line");
    if (validLines.some((line) => line.rate_status === "agreed" && num(line.rate) <= 0)) return setError("Agreed rate lines require a positive rate.");

    setSaving(true);
    try {
      const noRes = await supabase.rpc("next_order_book_no", { p_order_type: type });
      if (noRes.error) throw noRes.error;
      const party = parties.find((row) => row.id === partyId);
      const salesperson = salespeople.find((row) => row.id === salespersonId);
      const pending = validLines.some((line) => line.rate_status === "pending");
      const { data: header, error: headerError } = await supabase.from("order_book_headers").insert({
        order_type: type,
        order_no: noRes.data,
        order_date: orderDate,
        party_id: partyId,
        party_name: party?.name || "",
        salesperson_id: isSales ? salespersonId : null,
        salesperson_name: isSales ? salesperson?.name || null : null,
        status: pending ? "rate_pending" : "confirmed",
        remarks: remarks.trim() || null,
      }).select("id").single();
      if (headerError) throw headerError;

      const payload = validLines.map((line) => ({
        order_id: header.id,
        item_id: line.item_id,
        item_name: items.find((item) => item.id === line.item_id)?.name || "",
        ordered_qty: num(line.qty),
        uom: line.uom.trim() || "kg",
        rate_status: line.rate_status,
        agreed_rate: line.rate_status === "agreed" ? num(line.rate) : null,
        effective_at: line.rate_status === "agreed" ? new Date(`${line.effective_date}T00:00:00`).toISOString() : null,
        source: "order",
        remarks: line.remarks.trim() || null,
      }));
      const { error: lineError } = await supabase.from("order_book_commitments").insert(payload);
      if (lineError) throw lineError;

      setCreateOpen(false);
      setPartyId("");
      setSalespersonId("");
      setRemarks("");
      setOrderDate(today());
      setLines([emptyLine()]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create order.");
    } finally {
      setSaving(false);
    }
  };

  const reviseRate = async () => {
    if (!rateTarget) return;
    if (num(newRate) <= 0 || !rateReason.trim()) return setError("New rate and reason are required.");
    setSaving(true);
    setError(null);
    try {
      const { error } = await supabase.rpc("revise_order_book_rate", {
        p_commitment_id: rateTarget.id,
        p_new_rate: num(newRate),
        p_effective_date: rateDate,
        p_reason: rateReason.trim(),
      });
      if (error) throw error;
      setRateTarget(null);
      setNewRate("");
      setRateReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rate revision failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading Order Book…</div>;

  return (
    <div id="order-book-report" className="navilo-sales-neus professional-report space-y-4" data-navilo-report-standard="true">
      <PageHeader
        title={isSales ? "Sales Order Book" : "Purchase Order Book"}
        subtitle="Commitments only — no stock or accounting entry is posted from Order Book."
        action={<div className="flex flex-wrap gap-2"><OrderBookExportToolbar tableId="order-book-table" fileBase={isSales ? "sales-order-book" : "purchase-order-book"} /><OrderBookCustomerReport type={type} /><OrderBookQtyAdjustControl type={type} onChanged={() => void load()} /><OrderBookCancelControl type={type} onChanged={() => void load()} /><button type="button" className="btn-secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh</button><button type="button" className="btn-primary" onClick={() => setCreateOpen(true)} disabled={!enabled}><Plus className="h-4 w-4" />New Order</button></div>}
      />

      {error && <ErrorBanner message={error} />}
      {!enabled && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Order Book is disabled for this company. Enable it in <Link to="/settings/order-book" className="font-semibold underline">Order Book Settings</Link>.</div>}

      <section className="grid gap-3 md:grid-cols-6">
        <Stat label="Orders" value={String(totals.orders.size)} />
        <Stat label="Ordered Qty" value={totals.ordered.toLocaleString()} />
        <Stat label="Fulfilled" value={totals.fulfilled.toLocaleString()} />
        <Stat label="Cancelled" value={totals.cancelled.toLocaleString()} />
        <Stat label="Open Qty" value={totals.balance.toLocaleString()} />
        <Stat label="Open Agreed Value" value={formatCurrency(totals.openValue)} />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full max-w-lg"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, party, salesperson or item…" /></div>
        <div className="flex flex-wrap gap-2">{(["all", "open", "rate_pending", "completed"] as const).map((value) => <button key={value} type="button" className={filter === value ? "btn-primary" : "btn-secondary"} onClick={() => setFilter(value)}>{value.replace("_", " ")}</button>)}</div>
      </section>

      <section data-report-content data-navilo-customizable="true" data-navilo-print-surface className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table id="order-book-table" className="w-full min-w-[1050px] text-sm">
            <thead className="bg-slate-50"><tr className="border-b border-slate-200"><th className="p-3 text-left">Order</th><th className="p-3 text-left">Date</th><th className="p-3 text-left">Party</th>{isSales && <th className="p-3 text-left">Salesperson</th>}<th className="p-3 text-left">Item</th><th className="p-3 text-right">Ordered</th><th className="p-3 text-right">Fulfilled</th><th className="p-3 text-right">Balance</th><th className="p-3 text-right">Rate</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Action</th></tr></thead>
            <tbody>
              {visibleOrders.flatMap((order) => order.order_book_commitments.map((commitment, index) => {
                const balance = Math.max(0, num(commitment.ordered_qty) - num(commitment.fulfilled_qty) - num(commitment.cancelled_qty));
                return <tr key={commitment.id} className="border-b border-slate-100"><td className="p-3 font-semibold">{index === 0 ? order.order_no : ""}</td><td className="p-3">{index === 0 ? order.order_date : ""}</td><td className="p-3">{index === 0 ? order.party_name : ""}</td>{isSales && <td className="p-3">{index === 0 ? order.salesperson_name || "—" : ""}</td>}<td className="p-3"><div className="font-medium">{commitment.item_name}</div><div className="text-xs text-slate-500">{commitment.uom || "—"} · {commitment.source}</div></td><td className="p-3 text-right">{num(commitment.ordered_qty).toLocaleString()}</td><td className="p-3 text-right">{num(commitment.fulfilled_qty).toLocaleString()}</td><td className="p-3 text-right font-semibold">{balance.toLocaleString()}</td><td className="p-3 text-right">{commitment.rate_status === "agreed" ? formatCurrency(num(commitment.agreed_rate)) : <span className="font-semibold text-amber-700">Pending</span>}</td><td className="p-3 capitalize">{commitment.status}</td><td className="p-3 text-right">{commitment.status !== "cancelled" && commitment.status !== "completed" && <button type="button" className="btn-secondary text-xs" onClick={() => { setRateTarget(commitment); setNewRate(commitment.agreed_rate == null ? "" : String(commitment.agreed_rate)); setRateDate(commitment.effective_at ? String(commitment.effective_at).slice(0, 10) : today()); }}>Revise Rate</button>}</td></tr>;
              }))}
              {visibleOrders.length === 0 && <tr><td colSpan={isSales ? 11 : 10} className="p-8 text-center text-slate-400">No matching Order Book commitments.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {createOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold">New {isSales ? "Sales" : "Purchase"} Order Booking</h2><p className="text-sm text-slate-500">Commitment only; no accounting or stock posting.</p></div><button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Close</button></div><div className="grid gap-4 md:grid-cols-4"><div><label className="label">{isSales ? "Customer" : "Supplier"}</label><SearchableSelect className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}><option value="">— Select —</option>{parties.map((party) => <option key={party.id} value={party.id}>{party.name}{party.name_urdu ? ` / ${party.name_urdu}` : ""}</option>)}</SearchableSelect></div><div><label className="label">Order Date</label><input className="input" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>{isSales && <div><label className="label">Salesperson</label><SearchableSelect className="input" value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}><option value="">— Select —</option>{salespeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</SearchableSelect></div>}<div><label className="label">Remarks</label><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div><div className="mt-5 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-left">UOM</th><th className="p-2 text-left">Rate Status</th><th className="p-2 text-right">Rate</th><th className="p-2 text-left">Effective</th><th className="p-2 text-left">Remarks</th><th /></tr></thead><tbody>{lines.map((line, index) => <tr key={index} className="border-t border-slate-100"><td className="p-2"><SearchableSelect className="input" value={line.item_id} onChange={(e) => updateLine(index, "item_id", e.target.value)}><option value="">— Select item —</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SearchableSelect></td><td className="p-2"><input className="input text-right" type="number" min="0.001" step="0.001" value={line.qty} onChange={(e) => updateLine(index, "qty", e.target.value)} /></td><td className="p-2"><input className="input" value={line.uom} onChange={(e) => updateLine(index, "uom", e.target.value)} /></td><td className="p-2"><SearchableSelect className="input" value={line.rate_status} onChange={(e) => updateLine(index, "rate_status", e.target.value)}><option value="pending">Pending</option><option value="agreed">Agreed</option></SearchableSelect></td><td className="p-2"><input className="input text-right" type="number" min="0" step="0.01" disabled={line.rate_status === "pending"} value={line.rate} onChange={(e) => updateLine(index, "rate", e.target.value)} /></td><td className="p-2"><input className="input" type="date" disabled={line.rate_status === "pending"} value={line.effective_date} onChange={(e) => updateLine(index, "effective_date", e.target.value)} /></td><td className="p-2"><input className="input" value={line.remarks} onChange={(e) => updateLine(index, "remarks", e.target.value)} /></td><td className="p-2">{lines.length > 1 && <button type="button" className="text-rose-600" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove</button>}</td></tr>)}</tbody></table></div><div className="mt-3 flex justify-between"><button type="button" className="btn-secondary" onClick={() => setLines((current) => [...current, emptyLine()])}><Plus className="h-4 w-4" />Add Line</button><button type="button" className="btn-primary" disabled={saving} onClick={() => void createOrder()}><Save className="h-4 w-4" />{saving ? "Saving…" : "Save Order Booking"}</button></div></div></div>}

      {rateTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Revise Agreed Rate</h2><p className="mt-1 text-sm text-slate-500">{rateTarget.item_name} · Current {rateTarget.rate_status === "agreed" ? formatCurrency(num(rateTarget.agreed_rate)) : "Pending"}</p><div className="mt-4 grid gap-3"><div><label className="label">New Rate</label><input className="input text-right" type="number" min="0.01" step="0.01" value={newRate} onChange={(e) => setNewRate(e.target.value)} /></div><div><label className="label">Effective Date</label><input className="input" type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} /></div><div><label className="label">Reason</label><input className="input" value={rateReason} onChange={(e) => setRateReason(e.target.value)} /></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setRateTarget(null)}>Cancel</button><button type="button" className="btn-primary" disabled={saving} onClick={() => void reviseRate()}>{saving ? "Saving…" : "Save Rate Revision"}</button></div></div></div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-lg font-bold text-slate-900">{value}</div></div>;
}
