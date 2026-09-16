import {useCallback,useEffect,useState} from "react";
import {AlertTriangle,Boxes,ClipboardCheck,Container,MapPin,RefreshCw,Truck} from "lucide-react";
import {PageHeader} from "@/components/ui";
import {supabase} from "@/lib/supabase";

type Summary={company_id:string;business_unit_id:string;item_id:string;item_name:string;warehouse_id:string;godown_id:string;on_hand_qty:number;reserved_qty:number;available_qty:number;minimum_qty:number|null;reorder_qty:number|null;needs_reorder:boolean};
const n=(v:unknown)=>Number(v)||0;
export default function InventoryAdvanced(){
 const[rows,setRows]=useState<Summary[]>([]),[counts,setCounts]=useState({lots:0,bins:0,holds:0,transit:0,counts:0}),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const load=useCallback(async()=>{setLoading(true);setError("");const[s,l,b,h,t,c]=await Promise.all([
  supabase.from("inventory_control_summary").select("*").order("item_name"),
  supabase.from("inventory_lots").select("id",{count:"exact",head:true}),
  supabase.from("warehouse_bins").select("id",{count:"exact",head:true}).eq("is_active",true),
  supabase.from("goods_receipt_inspections").select("id",{count:"exact",head:true}).in("status",["pending","inspecting"]),
  supabase.from("inventory_control_documents").select("id",{count:"exact",head:true}).eq("status","in_transit"),
  supabase.from("stock_counts").select("id",{count:"exact",head:true}).in("status",["counting","submitted"])
 ]);const failed=[s,l,b,h,t,c].find(x=>x.error);if(failed?.error)setError(failed.error.message);setRows((s.data||[]) as Summary[]);setCounts({lots:l.count||0,bins:b.count||0,holds:h.count||0,transit:t.count||0,counts:c.count||0});setLoading(false)},[]);
 useEffect(()=>{void load()},[load]);const shortage=rows.filter(x=>x.needs_reorder);
 const cards=[["Tracked Lots / Heats",counts.lots,Container,"bg-blue-50 text-blue-700"],["Active Bins",counts.bins,MapPin,"bg-violet-50 text-violet-700"],["GRN Awaiting QC",counts.holds,ClipboardCheck,"bg-amber-50 text-amber-700"],["Transfers In Transit",counts.transit,Truck,"bg-cyan-50 text-cyan-700"],["Counts In Progress",counts.counts,Boxes,"bg-slate-100 text-slate-700"]] as const;
 return <div className="space-y-5"><PageHeader title="Inventory Advanced Controls" subtitle="Lot & heat traceability · reservations · QC · transfers · stock counts · valuation"/>
  <div className="flex justify-end"><button className="btn-secondary" disabled={loading} onClick={()=>void load()}><RefreshCw className={"h-4 w-4 "+(loading?"animate-spin":"")}/>Refresh</button></div>
  {error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label,value,Icon,tone])=><div key={label} className="rounded-xl border bg-white p-4 shadow-sm"><div className={"mb-3 flex h-9 w-9 items-center justify-center rounded-lg "+tone}><Icon className="h-5 w-5"/></div><div className="text-2xl font-black">{value}</div><div className="text-xs font-semibold text-slate-500">{label}</div></div>)}</div>
  <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex items-center gap-3 border-b px-4 py-3"><AlertTriangle className={shortage.length?"text-amber-600":"text-emerald-600"}/><div><h2 className="font-bold">Availability & Reorder Control</h2><p className="text-xs text-slate-500">{shortage.length} location(s) at or below minimum stock</p></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Item</th><th className="p-3 text-right">On hand</th><th className="p-3 text-right">Reserved</th><th className="p-3 text-right">Available</th><th className="p-3 text-right">Minimum</th><th className="p-3 text-right">Reorder Qty</th><th className="p-3">Status</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.item_id+":"+r.warehouse_id+":"+r.godown_id+":"+i} className="border-t"><td className="p-3 font-bold">{r.item_name}</td><td className="p-3 text-right tabular-nums">{n(r.on_hand_qty).toLocaleString()}</td><td className="p-3 text-right tabular-nums">{n(r.reserved_qty).toLocaleString()}</td><td className="p-3 text-right tabular-nums">{n(r.available_qty).toLocaleString()}</td><td className="p-3 text-right tabular-nums">{r.minimum_qty==null?"—":n(r.minimum_qty).toLocaleString()}</td><td className="p-3 text-right tabular-nums">{r.reorder_qty==null?"—":n(r.reorder_qty).toLocaleString()}</td><td className="p-3"><span className={"rounded-full px-2 py-1 text-xs font-bold "+(r.needs_reorder?"bg-amber-100 text-amber-800":"bg-emerald-100 text-emerald-800")}>{r.needs_reorder?"Reorder":"Healthy"}</span></td></tr>)}{!loading&&!rows.length&&<tr><td colSpan={7} className="p-10 text-center text-slate-400">No scoped stock rows available.</td></tr>}</tbody></table></div></section>
 </div>
}
