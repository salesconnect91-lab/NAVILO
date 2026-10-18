import TransportPagination from "../transport/TransportPagination";
import {fetchByIdChunks} from "@/lib/fetchAllPages";
import NaviloDateInput from '@/components/NaviloDateInput';
import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, PageHeader, formatDate } from "@/components/ui";

type Voucher = { id:string; entry_no:string; entry_date:string; party_name:string|null; payment_mode:string|null; trans_type:string|null; description:string|null };
type Reversal = { id:string; entry_no:string; entry_date:string; reversal_of_entry_id:string|null; reversal_reason:string|null };
type Line = { entry_id:string; debit:number|string; credit:number|string };
const money=(v:number)=>new Intl.NumberFormat("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v||0);

export default function PaymentReversals(){
  const [rows,setRows]=useState<Voucher[]>([]),[reversals,setReversals]=useState<Reversal[]>([]),[lines,setLines]=useState<Line[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState<string|null>(null);
  const [kind,setKind]=useState<"all"|"Customer Receipt"|"Supplier Payment">("all"),[search,setSearch]=useState("");
  const [page,setPage]=useState(0),[count,setCount]=useState(0);
  const generation=useRef(0);
  const [target,setTarget]=useState<Voucher|null>(null),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState("");
  const [ownerAllowed,setOwnerAllowed]=useState(false);
  useEffect(()=>{
    let live=true;setOwnerAllowed(false);
    void supabase.rpc('owner_posted_control_access').then(({data,error})=>{
      if(live&&!error)setOwnerAllowed(data===true);
    });
    return()=>{live=false};
  },[]);


  const load=useCallback(async()=>{
    const request=++generation.current;
    setLoading(true);setError("");
    try{
      let query=supabase.from("journal_entries").select("id,entry_no,entry_date,party_name,payment_mode,trans_type,description",{count:'exact'})
        .eq("status","posted").in("trans_type",["Customer Receipt","Supplier Payment"]);
      if(kind!=="all")query=query.eq("trans_type",kind);
      const term=search.trim();
      if(term){
        const pattern=JSON.stringify(`%${term.replace(/[\\%_]/g,'\\$&')}%`);
        query=query.or(['entry_no','party_name','payment_mode','description'].map(field=>`${field}.ilike.${pattern}`).join(','));
      }
      const v=await query.order("entry_date",{ascending:false}).order("entry_no",{ascending:false}).order("id").range(page*250,page*250+249);
      if(v.error)throw v.error;
      const vv=(v.data??[]) as Voucher[],ids=vv.map(x=>x.id);
      const [rr,ll]=await Promise.all([
        fetchByIdChunks<Reversal>(ids,(chunk,from,to)=>supabase.from("journal_entries").select("id,entry_no,entry_date,reversal_of_entry_id,reversal_reason")
          .eq("status","posted").in("trans_type",["Customer Receipt Reversal","Supplier Payment Reversal"])
          .in("reversal_of_entry_id",chunk).order("id").range(from,to)),
        fetchByIdChunks<Line>(ids,(chunk,from,to)=>supabase.from("journal_lines").select("entry_id,debit,credit").in("entry_id",chunk).order("id").range(from,to))
      ]);
      if(request!==generation.current)return;
      setRows(vv);setReversals(rr);setLines(ll);setCount(v.count??vv.length);
    }catch(e:any){if(request===generation.current){setError(e?.message||"Could not load payment vouchers.");setRows([]);setReversals([]);setLines([]);setCount(0);}}
    finally{if(request===generation.current)setLoading(false);}
  },[page,kind,search]);
  useEffect(()=>{setLoading(true);const timer=window.setTimeout(()=>void load(),200);return()=>{window.clearTimeout(timer);generation.current++;}},[load]);
  const reversed=useMemo(()=>new Map(reversals.filter(x=>x.reversal_of_entry_id).map(x=>[x.reversal_of_entry_id!,x])),[reversals]);
  const amount=(id:string)=>lines.filter(x=>x.entry_id===id).reduce((m,x)=>Math.max(m,Number(x.debit)||0,Number(x.credit)||0),0);
  const filtered=rows;

  const reverse=async()=>{
    if(!target)return;
    if(!ownerAllowed){setError('Only the active company owner or platform owner may reverse posted vouchers.');return;}
    if(reason.trim().length<10){setError("A cancellation reason of at least 10 characters is required.");return;}
    setBusy(target.id);setError("");
    try{
      const {data,error:e}=await supabase.rpc("owner_cancel_unallocated_payment",{p_entry_id:target.id,p_reversal_date:date,p_reason:reason.trim()});
      if(e)throw e;
      setTarget(null);setReason("");await load();window.alert(`${(data as any)?.reversal_entry_no||"Reversal"} posted successfully.`);
    }catch(e:any){setError(e?.message||"Could not reverse payment voucher.");}
    finally{setBusy(null);}
  };

  return <div className="space-y-4">
    <PageHeader title="Payment Voucher Reversals" subtitle="Owner-only cancellation of eligible unallocated customer receipts or supplier payments. Allocated, FX and Transport-linked vouchers require separate controlled correction. Originals remain posted and locked." action={<div className="flex items-center gap-2"><span data-navilo-standard-tools-host className="contents" /></div>}/>
    {!ownerAllowed&&<p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">Posted payment reversal is restricted to the active Company Owner or Platform Owner. This list remains read-only for other users.</p>}
    {error&&<ErrorBanner message={error}/>}<div className="card flex flex-wrap items-center gap-2 p-4" data-no-print data-no-export><input className="input min-w-64 flex-1" value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Search voucher, party, method..."/><SearchableSelect className="input w-auto" value={kind} onChange={e=>{setKind(e.target.value as any);setPage(0)}}><option value="all">All payments</option><option value="Customer Receipt">Customer Receipts</option><option value="Supplier Payment">Supplier Payments</option></SearchableSelect><button className="btn btn-secondary" disabled={loading||busy!==null} onClick={()=>void load()}><RefreshCw size={15}/>Refresh</button></div>

    {loading&&<p role="status" className="text-xs text-slate-500">Loading payment vouchers…</p>}
    <section className="card overflow-hidden" data-report-content data-navilo-customizable="true">
      <div className="border-b px-5 py-3"><div className="navilo-report-title font-semibold">Payment Voucher Reversals</div><div className="mt-1 text-xs text-slate-500">{count.toLocaleString()} voucher{count===1?"":"s"} • {kind === "all" ? "All payment types" : kind}</div></div>
      <div className="overflow-x-auto"><table className="table w-full"><thead><tr><th>Voucher</th><th>Date</th><th>Type</th><th>Party</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th data-no-print data-no-export>Action</th></tr></thead><tbody>{filtered.length?filtered.map(v=>{const rv=reversed.get(v.id);return <tr key={v.id}><td className="font-semibold">{v.entry_no}</td><td>{formatDate(v.entry_date)}</td><td>{v.trans_type}</td><td>{v.party_name||"—"}</td><td>{v.payment_mode||"—"}</td><td className="text-right font-semibold">Rs {money(amount(v.id))}</td><td>{rv?<span className="badge bg-slate-100 text-slate-700">Reversed: {rv.entry_no}</span>:<span className="badge bg-emerald-50 text-emerald-700">Posted</span>}</td><td data-no-print data-no-export>{!rv&&ownerAllowed&&<button className="btn btn-danger" disabled={loading||busy!==null} onClick={()=>{setTarget(v);setDate(new Date().toISOString().slice(0,10));setReason("")}}><RotateCcw size={14}/>Reverse</button>}</td></tr>}):<tr><td colSpan={8} className="py-10 text-center text-slate-500">{loading?"Loading payment vouchers…":"No payment vouchers found."}</td></tr>}</tbody></table></div>
    </section>
    <TransportPagination page={page} pageSize={250} count={count} busy={loading||busy!==null} onPage={setPage}/>

    {target&&<div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/50 p-4" data-no-print data-no-export><div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl"><h2 className="text-lg font-bold">Reverse {target.entry_no}</h2><p className="mt-1 text-sm text-slate-500">This creates a new opposite journal and restores invoice allocation/outstanding. The original posted voucher remains in audit history.</p><div className="mt-4 grid gap-3"><label className="text-sm font-semibold">Reversal Date<NaviloDateInput className="input mt-1" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="text-sm font-semibold">Mandatory Reason<textarea className="input mt-1" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Wrong amount / wrong party / bank entry correction..."/></label></div><div className="mt-5 flex justify-end gap-2"><button className="btn btn-secondary" onClick={()=>setTarget(null)}>Cancel</button><button className="btn btn-danger" disabled={busy===target.id||reason.trim().length<10} onClick={()=>void reverse()}><RotateCcw size={14}/>{busy===target.id?"Reversing...":"Post Reversal"}</button></div></div></div>}
  </div>
}
