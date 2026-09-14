import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, LoadingState, PageHeader, formatDate } from "@/components/ui";

type NoteType = "sales_credit" | "purchase_debit";
interface Order { id: string; order_no: string; order_date: string; total: number; party_name: string; }
interface InvoiceLine { id: string; item_id: string; godown_id: string | null; qty: number; rate: number; tax_percent: number; item_name: string; returned: number; returnQty: string; }
interface Note { id: string; note_no: string; note_type: NoteType; note_date: string; party_name: string; reason: string; total: number; sales_order_id: string | null; purchase_order_id: string | null; }

const money = (value: number) => new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

export default function ReturnNotes() {
  const [type, setType] = useState<NoteType>("sales_credit");
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderId, setOrderId] = useState("");
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const isSale = type === "sales_credit";
    const [orderResult, noteResult] = await Promise.all([
      supabase.from(isSale ? "sales_orders" : "purchase_orders")
        .select(isSale ? "id,order_no,order_date,total,tax_percent,customer:customers(name)" : "id,order_no,order_date,total,tax_percent,supplier:suppliers(name)")
        .eq("status", "posted").order("order_date", { ascending: false }),
      supabase.from("return_notes").select("id,note_no,note_type,note_date,party_name,reason,total,sales_order_id,purchase_order_id")
        .eq("note_type", type).order("note_date", { ascending: false }).limit(100),
    ]);
    if (orderResult.error) setError(orderResult.error.message);
    else setOrders((orderResult.data ?? []).map((row: any) => ({ ...row, party_name: row.customer?.name ?? row.supplier?.name ?? "—" })));
    if (noteResult.error) setError((current) => current || noteResult.error!.message);
    else setNotes((noteResult.data ?? []) as Note[]);
    setLoading(false);
  }, [type]);

  useEffect(() => { setOrderId(""); setLines([]); void load(); }, [load]);

  useEffect(() => {
    if (!orderId) { setLines([]); return; }
    void (async () => {
      setError("");
      const isSale = type === "sales_credit";
      const { data, error: lineError } = await supabase.from(isSale ? "sales_order_lines" : "purchase_order_lines")
        .select(isSale ? "id,item_id,godown_id,qty,unit_price,tax_percent,item:items(name)" : "id,item_id,godown_id,qty,unit_cost,item:items(name)")
        .eq("order_id", orderId).order("id");
      if (lineError) { setError(lineError.message); return; }
      const ids = (data ?? []).map((row: any) => row.id);
      let returned = new Map<string, number>();
      if (ids.length) {
        const { data: prior, error: priorError } = await supabase.from("return_note_lines").select("original_line_id,qty").in("original_line_id", ids);
        if (priorError) { setError(priorError.message); return; }
        returned = (prior ?? []).reduce((map: Map<string, number>, row: any) => map.set(row.original_line_id, (map.get(row.original_line_id) ?? 0) + Number(row.qty)), new Map());
      }
      const selectedOrder: any = orders.find((order) => order.id === orderId);
      setLines((data ?? []).map((row: any) => ({
        id: row.id, item_id: row.item_id, godown_id: row.godown_id, qty: Number(row.qty),
        rate: Number(isSale ? row.unit_price : row.unit_cost), tax_percent: Number(isSale ? row.tax_percent : selectedOrder?.tax_percent ?? 0),
        item_name: row.item?.name ?? "Unknown item", returned: returned.get(row.id) ?? 0, returnQty: "",
      })));
    })();
  }, [orderId, orders, type]);

  const totals = useMemo(() => lines.reduce((sum, line) => {
    const qty = Number(line.returnQty || 0); const net = qty * line.rate; return { net: sum.net + net, tax: sum.tax + net * line.tax_percent / 100 };
  }, { net: 0, tax: 0 }), [lines]);

  async function postNote() {
    const selected = lines.filter((line) => Number(line.returnQty) > 0);
    if (!orderId) return setError("Select the original posted invoice.");
    if (!reason.trim()) return setError("Return reason is required.");
    if (!selected.length) return setError("Enter at least one return quantity.");
    const invalid = selected.find((line) => Number(line.returnQty) > line.qty - line.returned || !line.godown_id);
    if (invalid) return setError(`${invalid.item_name}: quantity exceeds remaining quantity or godown is missing.`);
    if (!window.confirm(`Post ${type === "sales_credit" ? "Sales Credit Note" : "Purchase Debit Note"} for ${money(totals.net + totals.tax)}?`)) return;
    setPosting(true); setError(""); setSuccess("");
    const { data, error: rpcError } = await supabase.rpc("create_and_post_return_note", {
      p_note_type: type, p_order_id: orderId, p_note_date: noteDate, p_reason: reason.trim(),
      p_lines: selected.map((line) => ({ line_id: line.id, qty: Number(line.returnQty) })),
    });
    if (rpcError) setError(rpcError.message);
    else { setSuccess(`${data.note_no} posted successfully.`); setReason(""); setOrderId(""); setLines([]); await load(); }
    setPosting(false);
  }

  function printNote(note: Note) {
    const source = orders.find((order) => order.id === (note.sales_order_id ?? note.purchase_order_id));
    const popup = window.open("", "_blank", "width=900,height=700"); if (!popup) return;
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));
    popup.document.write(`<html><head><title>${esc(note.note_no)}</title><style>body{font:14px Arial;padding:40px;color:#172033}.head{display:flex;justify-content:space-between;border-bottom:2px solid #173a5e;padding-bottom:18px}h1{margin:0;color:#173a5e}.brand{font-size:13px;font-weight:700;color:#475569;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:25px}td{padding:10px;border-bottom:1px solid #ddd}.amt{text-align:right;font-size:22px;font-weight:bold}.foot{margin-top:55px;border-top:1px solid #bbb;padding-top:10px;color:#666}@media print{button{display:none}}</style></head><body><div class="head"><div><h1>${note.note_type === "sales_credit" ? "SALES CREDIT NOTE" : "PURCHASE DEBIT NOTE"}</h1><div class="brand">NAVILO</div></div><div><b>${esc(note.note_no)}</b><br>${esc(formatDate(note.note_date))}</div></div><table><tr><td>Party</td><td><b>${esc(note.party_name)}</b></td></tr><tr><td>Original Invoice</td><td>${esc(source?.order_no ?? "—")}</td></tr><tr><td>Reason</td><td>${esc(note.reason)}</td></tr><tr><td>Total Adjustment</td><td class="amt">${money(note.total)}</td></tr></table><div class="foot">System-posted document • Stock and accounting entries are linked to this note.</div><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  }

  if (loading) return <LoadingState />;
  return <div className="space-y-4">
    <PageHeader title="Credit / Debit Notes" subtitle="Post invoice-linked sales returns and purchase returns with automatic stock and accounting reversal." action={<div className="flex items-center gap-2"><span data-navilo-standard-tools-host className="contents" /></div>} />
    {error && <ErrorBanner message={error} />}{success && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

    <div className="card p-5" data-no-print data-no-export>
      <div className="mb-4 flex gap-2"><button className={type === "sales_credit" ? "btn btn-primary" : "btn btn-secondary"} onClick={() => setType("sales_credit")}>Sales Credit Note</button><button className={type === "purchase_debit" ? "btn btn-primary" : "btn btn-secondary"} onClick={() => setType("purchase_debit")}>Purchase Debit Note</button></div>
      <div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium">Original posted invoice<SearchableSelect className="input mt-1 w-full" value={orderId} onChange={(e) => setOrderId(e.target.value)}><option value="">Select invoice</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.order_no} — {o.party_name} — {money(o.total)}</option>)}</SearchableSelect></label><label className="text-sm font-medium">Note date<input className="input mt-1 w-full" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} /></label><label className="text-sm font-medium">Mandatory reason<input className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged / rejected / rate correction" /></label></div>
      {orderId && <div className="mt-5 overflow-x-auto"><table className="table"><thead><tr><th>Item</th><th className="text-right">Invoice Qty</th><th className="text-right">Already Returned</th><th className="text-right">Remaining</th><th className="text-right">Rate</th><th className="w-32 text-right">Return Qty</th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.id}><td>{line.item_name}{!line.godown_id && <div className="text-xs text-red-600">Godown missing</div>}</td><td className="text-right">{line.qty}</td><td className="text-right">{line.returned}</td><td className="text-right font-medium">{line.qty-line.returned}</td><td className="text-right">{money(line.rate)}</td><td><input className="input w-28 text-right" type="number" min="0" max={line.qty-line.returned} step="0.001" value={line.returnQty} onChange={(e) => setLines((current) => current.map((item, i) => i === index ? {...item,returnQty:e.target.value}:item))} /></td></tr>)}</tbody></table><div className="mt-4 flex items-center justify-end gap-5"><div className="text-right text-sm"><div>Net: {money(totals.net)}</div><div>VAT: {money(totals.tax)}</div><div className="text-lg font-bold">Total: {money(totals.net+totals.tax)}</div></div><button className="btn btn-primary" disabled={posting} onClick={postNote}><RotateCcw size={16}/>{posting ? "Posting..." : "Post Return Note"}</button></div></div>}
    </div>

    <section className="card overflow-hidden" data-report-content data-navilo-customizable="true">
      <div className="border-b px-5 py-3"><div className="navilo-report-title font-semibold">Posted Credit / Debit Notes</div><div className="mt-1 text-xs text-slate-500">{notes.length} posted note{notes.length === 1 ? "" : "s"} • {type === "sales_credit" ? "Sales Credit Notes" : "Purchase Debit Notes"}</div></div>
      <div className="overflow-x-auto"><table className="table"><thead><tr><th>Note</th><th>Date</th><th>Party</th><th>Type</th><th>Reason</th><th className="text-right">Total</th><th data-no-print data-no-export>Action</th></tr></thead><tbody>{notes.length ? notes.map((note) => <tr key={note.id}><td className="font-medium">{note.note_no}</td><td>{formatDate(note.note_date)}</td><td>{note.party_name}</td><td>{note.note_type === "sales_credit" ? "Sales Credit" : "Purchase Debit"}</td><td>{note.reason}</td><td className="text-right font-medium">{money(note.total)}</td><td data-no-print data-no-export><button className="btn btn-secondary" data-direct-print onClick={() => printNote(note)}><Printer size={15}/>Print Note</button></td></tr>) : <tr><td colSpan={7} className="py-10 text-center text-slate-500">No posted return notes.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
