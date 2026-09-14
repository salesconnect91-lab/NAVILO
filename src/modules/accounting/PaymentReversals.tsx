import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner, LoadingState, PageHeader, formatDate } from "@/components/ui";

type Voucher = { id:string; entry_no:string; entry_date:string; party_name:string|null; payment_mode:string|null; trans_type:string|null; description:string|null };
type Reversal = { id:string; entry_no:string; entry_date:string; reversal_of_entry_id:string|null; reversal_reason:string|null };
type Line = { entry_id:string; debit:number|string; credit:number|string };
const money=(v:number)=>new Intl.NumberFormat("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v||0);

export default function PaymentReversals(){
  const [rows,setRows]=useState<Voucher[]>([]),[reversals,setReversals]=useState<Reversal[]>([]),[lines,setLines]=useState<Line[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState<string|null>(null);
  const [kind,setKind]=useState<"all"|"Customer Receipt"|"Supplier Payment">("all"),[search,setSearch]=useState("");
  const [target,setTarget]=useState<Voucher|null>(null),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    const [v,r]=await Promise.all([
      supabase.from("journal_entries").select("id,entry_no,entry_date,party_name,payment_mode,trans_type,description").eq("status","posted").in("trans_type",["Customer Receipt","Supplier Payment"]).order("entry_date",{ascending:false}).order("entry_no",{ascending:false}).limit(250),
      supabase.from("journal_entries").select("id,entry_no,entry_date,reversal_of_entry_id,reversal_reason").eq("status","posted").in("trans_type",["Customer Receipt Reversal","Supplier Payment Reversal"]).order("entry_date",{ascending:false}).limit(250),
    ]);
    if(v.error||r.error){setError(v.error?.message||r.error?.message||"Could not load payment vouchers.");setLoading(false);return;}
    const vv=(v.data??[]) as Voucher[];setRows(vv);setReversals((r.data??[]) as Reversal[]);
    if(vv.length){const l=await supabase.from("journal_lines").select("entry_id,debit,credit").in("entry_id",vv.map(x=>x.id));if(l.error)setError(l.error.message);else setLines((l.data??[]) as Line[]);}else setLines([]);
    setLoading(false);
  },[]);
  useEffect(()=>{void load()},[load]);
  const reversed=useMemo(()=>new Map(reversals.filter(x=>x.reversal_of_entry_id).map(x=>[x.reversal_of_entry_id!,x])),[reversals]);
  const amount=(id:string)=>lines.filter(x=>x.entry_id===id).reduce((m,x)=>Math.max(m,Number(x.debit)||0,Number(x.credit)||0),0);
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return rows.filter(x=>(kind==="all"||x.trans_type===kind)&&(!q||[x.entry_no,x.party_name,x.payment_mode,x.description].filter(Boolean).join(" ").toLowerCase().includes(q)))},[rows,kind,search]);

  const reverse=async()=>{
    if(!target)return;if(!reason.trim()){setError("Reversal reason is required.");return;}
    setBusy(target.id);setError("");
    const {data,error:e}=await supabase.rpc("reverse_payment_voucher",{p_journal_entry_id:target.id,p_reversal_date:date,p_reason:reason.trim()});
    if(e)setError(e.message);else{setTarget(null);setReason("");await load();window.alert(`${(data as any)?.reversal_entry_no||"Reversal"} posted successfully.`)}
    setBusy(null);
  };

  if(loading)return <LoadingState/>;
  return <div className="space-y-4">
    <PageHeader title="Payment Voucher Reversals / ادائیگی واپسی" subtitle="Reverse a posted customer receipt or supplier payment through a separate audited journal. Original vouchers are never edited or deleted." action={<div className="flex items-center gap-2"><span data-navilo-standard-tools-host className="contents" /></div>}/>
    {error&&<ErrorBanner message={error}/>}<div className="card flex flex-wrap items-center gap-2 p-4" data-no-print data-no-export><input className="input min-w-64 flex-1" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search voucher, party, method..."/><SearchableSelect className="input w-auto" value={kind} onChange={e=>setKind(e.target.value as any)}><option value="all">All payments</option><option value="Customer Receipt">Customer Receipts</option><option value="Supplier Payment">Supplier Payments</option></SearchableSelect><button className="btn btn-secondary" onClick={()=>void load()}><RefreshCw size={15}/>Refresh</button></div>

    <section className="card overflow-hidden" data-report-content data-navilo-customizable="true">
      <div className="border-b px-5 py-3"><div className="navilo-report-title font-semibold">Payment Voucher Reversals</div><div className="mt-1 text-xs text-slate-500">{filtered.length} voucher{filtered.length===1?"":"s"} • {kind === "all" ? "All payment types" : kind}</div></div>
      <div className="overflow-x-auto"><table className="table w-full"><thead><tr><th>Voucher</th><th>Date</th><th>Type</th><th>Party</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th data-no-print data-no-export>Action</th></tr></thead><tbody>{filtered.length?filtered.map(v=>{const rv=reversed.get(v.id);return <tr key={v.id}><td className="font-semibold">{v.entry_no}</td><td>{formatDate(v.entry_date)}</td><td>{v.trans_type}</td><td>{v.party_name||"—"}</td><td>{v.payment_mode||"—"}</td><td className="text-right font-semibold">Rs {money(amount(v.id))}</td><td>{rv?<span className="badge bg-slate-100 text-slate-700">Reversed: {rv.entry_no}</span>:<span className="badge bg-emerald-50 text-emerald-700">Posted</span>}</td><td data-no-print data-no-export>{!rv&&<button className="btn btn-danger" onClick={()=>{setTarget(v);setDate(new Date().toISOString().slice(0,10));setReason("")}}><RotateCcw size={14}/>Reverse</button>}</td></tr>}):<tr><td colSpan={8} className="py-10 text-center text-slate-500">No payment vouchers found.</td></tr>}</tbody></table></div>
    </section>

    {target&&<div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/50 p-4" data-no-print data-no-export><div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl"><h2 className="text-lg font-bold">Reverse {target.entry_no}</h2><p className="mt-1 text-sm text-slate-500">This creates a new opposite journal and restores invoice allocation/outstanding. The original posted voucher remains in audit history.</p><div className="mt-4 grid gap-3"><label className="text-sm font-semibold">Reversal Date<input className="input mt-1" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="text-sm font-semibold">Mandatory Reason<textarea className="input mt-1" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Wrong amount / wrong party / bank entry correction..."/></label></div><div className="mt-5 flex justify-end gap-2"><button className="btn btn-secondary" onClick={()=>setTarget(null)}>Cancel</button><button className="btn btn-danger" disabled={busy===target.id||!reason.trim()} onClick={()=>void reverse()}><RotateCcw size={14}/>{busy===target.id?"Reversing...":"Post Reversal"}</button></div></div></div>}
  </div>
}
