import {useCallback,useEffect,useState} from "react";
import {Activity,Boxes,ClipboardCheck,Factory,RefreshCw,Wrench} from "lucide-react";
import {PageHeader} from "@/components/ui";
import {supabase} from "@/lib/supabase";

type Row={id:string;order_no:string;status:string;qty:number;item_name:string|null;version_no:number|null;required_qty:number;reserved_qty:number;output_qty:number;rejected_qty:number};
type Metric={label:string;value:number;icon:typeof Factory;tone:string};
const num=(v:unknown)=>Number(v)||0;
export default function ManufacturingCore(){
 const[rows,setRows]=useState<Row[]>([]),[counts,setCounts]=useState({centers:0,boms:0,qc:0,maintenance:0,downtime:0}),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const load=useCallback(async()=>{setLoading(true);setError("");const[w,c,b,q,m,d]=await Promise.all([
  supabase.from("manufacturing_work_order_summary").select("*").order("order_no",{ascending:false}).limit(100),
  supabase.from("work_centers").select("id",{count:"exact",head:true}).eq("is_active",true),
  supabase.from("bom_versions").select("id",{count:"exact",head:true}).eq("status","approved"),
  supabase.from("quality_inspections").select("id",{count:"exact",head:true}).in("status",["pending","hold"]),
  supabase.from("maintenance_work_orders").select("id",{count:"exact",head:true}).in("status",["open","planned","in_progress"]),
  supabase.from("downtime_events").select("id",{count:"exact",head:true}).is("ended_at",null)
 ]);const first=[w,c,b,q,m,d].find(x=>x.error);if(first?.error)setError(first.error.message);setRows((w.data||[]) as Row[]);setCounts({centers:c.count||0,boms:b.count||0,qc:q.count||0,maintenance:m.count||0,downtime:d.count||0});setLoading(false)},[]);
 useEffect(()=>{void load()},[load]);
 const metrics:Metric[]=[{label:"Active Work Centers",value:counts.centers,icon:Factory,tone:"text-blue-700 bg-blue-50"},{label:"Approved BOMs",value:counts.boms,icon:Boxes,tone:"text-violet-700 bg-violet-50"},{label:"QC Pending / Hold",value:counts.qc,icon:ClipboardCheck,tone:"text-amber-700 bg-amber-50"},{label:"Open Maintenance",value:counts.maintenance,icon:Wrench,tone:"text-orange-700 bg-orange-50"},{label:"Active Downtime",value:counts.downtime,icon:Activity,tone:"text-red-700 bg-red-50"}];
 return <div className="space-y-5"><PageHeader title="Manufacturing Core" subtitle="BOM · Routing · MRP · Production · Quality · Maintenance · Costing"/>
  <div className="flex justify-end"><button className="btn-secondary" onClick={()=>void load()} disabled={loading}><RefreshCw className={"h-4 w-4 "+(loading?"animate-spin":"")}/>Refresh</button></div>
  {error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(({label,value,icon:Icon,tone})=><div key={label} className="rounded-xl border bg-white p-4 shadow-sm"><div className={"mb-3 flex h-9 w-9 items-center justify-center rounded-lg "+tone}><Icon className="h-5 w-5"/></div><div className="text-2xl font-black">{value}</div><div className="text-xs font-semibold text-slate-500">{label}</div></div>)}</div>
  <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><h2 className="font-bold">Work Order Control</h2><p className="text-xs text-slate-500">Material coverage, output and rejection visibility</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Order</th><th className="p-3">Item / BOM</th><th className="p-3">Status</th><th className="p-3 text-right">Plan</th><th className="p-3 text-right">Required</th><th className="p-3 text-right">Reserved</th><th className="p-3 text-right">Output</th><th className="p-3 text-right">Rejected</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-t"><td className="p-3 font-bold">{r.order_no}</td><td className="p-3">{r.item_name||"—"}<div className="text-xs text-slate-400">{r.version_no?"BOM v"+r.version_no:"No BOM assigned"}</div></td><td className="p-3 capitalize">{r.status}</td>{[r.qty,r.required_qty,r.reserved_qty,r.output_qty,r.rejected_qty].map((v,i)=><td key={i} className="p-3 text-right tabular-nums">{num(v).toLocaleString()}</td>)}</tr>)}{!loading&&!rows.length&&<tr><td colSpan={8} className="p-10 text-center text-slate-400">No work orders in this business unit.</td></tr>}</tbody></table></div></section>
 </div>
}
