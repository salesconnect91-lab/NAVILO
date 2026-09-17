import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { ErrorBanner, LoadingState, PageHeader, formatDate } from "@/components/ui";

interface Account { id: string; code: string; name: string; detail_type?: string | null; }
interface Reconciliation { id:string; account_id:string; statement_start:string; statement_end:string; opening_statement_balance:number; closing_statement_balance:number; calculated_statement_balance:number; book_balance:number; difference:number; status:"draft"|"closed"; notes:string|null; closed_at:string|null; account?:Account|null; }
interface LedgerRow { id:string; entry_date:string; description:string|null; debit:number; credit:number; journal_entry_id:string|null; }
interface ReconItem { ledger_id:string; reconciliation_id:string; cleared_date:string; }

const localIsoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today = localIsoDate();
const monthStart = `${today.slice(0,8)}01`;
const money = (n:number) => new Intl.NumberFormat("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);

export default function BankReconciliation() {
  const { activeCompany, activeBusinessUnit } = useAuth();
  const companyId = activeCompany?.company_id;
  const businessUnitId = activeBusinessUnit?.business_unit_id;
  const [accounts,setAccounts]=useState<Account[]>([]); const [recs,setRecs]=useState<Reconciliation[]>([]);
  const [active,setActive]=useState<Reconciliation|null>(null); const [rows,setRows]=useState<LedgerRow[]>([]); const [items,setItems]=useState<ReconItem[]>([]);
  const [form,setForm]=useState({account_id:"",start:monthStart,end:today,opening:"0",closing:"0",notes:""});
  const [clearedDate,setClearedDate]=useState(today); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState("");
  const [error,setError]=useState(""); const [success,setSuccess]=useState("");

  const loadMaster=useCallback(async()=>{
    if(!companyId){setAccounts([]);setRecs([]);setLoading(false);return;}
    setLoading(true); setError("");
    let recQuery=supabase.from("bank_reconciliations").select("*,account:chart_of_accounts(id,code,name,detail_type)").eq("company_id",companyId).order("statement_end",{ascending:false});
    if(businessUnitId) recQuery=recQuery.eq("business_unit_id",businessUnitId);
    const [accountsResult,mappingResult,recsResult]=await Promise.all([
      supabase.from("chart_of_accounts").select("id,code,name,type,is_active,is_group,detail_type").eq("company_id",companyId).eq("type","asset").eq("is_active",true).eq("is_group",false).order("code"),
      supabase.from("account_mappings").select("account_id").eq("company_id",companyId).eq("mapping_key","bank").maybeSingle(),
      recQuery,
    ]);
    if(accountsResult.error||mappingResult.error||recsResult.error) setError(accountsResult.error?.message||mappingResult.error?.message||recsResult.error?.message||"Load failed.");
    const mapped=mappingResult.data?.account_id;
    const bankAccounts=(accountsResult.data??[]).filter((a:any)=>a.id===mapped||String(a.detail_type??"").toLowerCase()==="bank account");
    setAccounts(bankAccounts as Account[]); setRecs((recsResult.data??[]) as Reconciliation[]);
    setForm(f=>({...f,account_id:bankAccounts.some((a:any)=>a.id===f.account_id)?f.account_id:(bankAccounts[0]?.id??"")}));
    setLoading(false);
  },[companyId,businessUnitId]);

  useEffect(()=>{void loadMaster();},[loadMaster]);

  const loadDetails=useCallback(async(rec:Reconciliation)=>{
    if(!companyId||!businessUnitId)return;
    setActive(rec); setClearedDate(rec.statement_end); setBusy("load"); setError("");
    const [ledgerResult,itemResult]=await Promise.all([
      supabase.from("ledgers").select("id,entry_date,description,debit,credit,journal_entry_id").eq("company_id",companyId).eq("business_unit_id",businessUnitId).eq("account_id",rec.account_id).lte("entry_date",rec.statement_end).order("entry_date"),
      supabase.from("bank_reconciliation_items").select("ledger_id,reconciliation_id,cleared_date").eq("company_id",companyId).eq("business_unit_id",businessUnitId),
    ]);
    if(ledgerResult.error||itemResult.error) setError(ledgerResult.error?.message||itemResult.error?.message||"Details failed to load.");
    else { const all=(itemResult.data??[]) as ReconItem[]; setItems(all); setRows(((ledgerResult.data??[]) as LedgerRow[]).filter((r)=>!all.some((i)=>i.ledger_id===r.id)||all.some((i)=>i.ledger_id===r.id&&i.reconciliation_id===rec.id))); }
    setBusy("");
  },[companyId,businessUnitId]);

  async function refreshActive(id:string){
    if(!companyId||!businessUnitId)return;
    const {data:r}=await supabase.from("bank_reconciliations").select("*,account:chart_of_accounts(id,code,name,detail_type)").eq("company_id",companyId).eq("business_unit_id",businessUnitId).eq("id",id).single();
    if(r){await loadMaster();await loadDetails(r as Reconciliation);}
  }

  async function createRecon(){
    setBusy("create");setError("");setSuccess("");
    const {data,error:e}=await supabase.rpc("create_bank_reconciliation",{p_account_id:form.account_id,p_statement_start:form.start,p_statement_end:form.end,p_opening_balance:Number(form.opening),p_closing_balance:Number(form.closing),p_notes:form.notes||null});
    if(e)setError(e.message);else if(data?.reconciliation_id){setSuccess("Draft bank reconciliation created.");await refreshActive(data.reconciliation_id);}
    setBusy("");
  }

  async function toggle(row:LedgerRow,checked:boolean){
    if(!active)return;setBusy(row.id);setError("");
    const {error:e}=await supabase.rpc("set_bank_transaction_cleared",{p_reconciliation_id:active.id,p_ledger_id:row.id,p_cleared:checked,p_cleared_date:checked?clearedDate:null});
    if(e)setError(e.message);else await refreshActive(active.id);
    setBusy("");
  }

  async function closeRecon(){if(!active||!window.confirm("Close and permanently lock this reconciliation?"))return;setBusy("close");setError("");const{error:e}=await supabase.rpc("close_bank_reconciliation",{p_reconciliation_id:active.id});if(e)setError(e.message);else{setSuccess("Bank reconciliation closed and locked.");setActive(null);setRows([]);await loadMaster();}setBusy("");}
  async function cancelRecon(){if(!active||!window.confirm("Cancel this draft reconciliation? Selected clearings will be removed."))return;setBusy("cancel");setError("");const{error:e}=await supabase.rpc("cancel_bank_reconciliation",{p_reconciliation_id:active.id});if(e)setError(e.message);else{setActive(null);setRows([]);setSuccess("Draft cancelled.");await loadMaster();}setBusy("");}

  const selectedIds=useMemo(()=>new Set(items.filter(i=>i.reconciliation_id===active?.id).map(i=>i.ledger_id)),[items,active]);
  const outstanding=useMemo(()=>rows.filter(r=>!selectedIds.has(r.id)),[rows,selectedIds]);

  if(loading)return <LoadingState/>;
  return <div>
    <PageHeader title="Bank Reconciliation / بینک ریکنسیلی ایشن" subtitle="Match bank-ledger transactions with the bank statement and close only at zero difference."/>
    {error&&<ErrorBanner message={error}/>} {success&&<div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

    {!active&&<div className="card mb-5 p-5" data-report-filters>
      <h3 className="mb-4 font-semibold">New Reconciliation</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium">Bank account<SearchableSelect className="input mt-1 w-full" value={form.account_id} onChange={e=>setForm({...form,account_id:e.target.value})}><option value="">Select bank</option>{accounts.map(a=><option key={a.id} value={a.id} data-search={a.code}>{a.name}</option>)}</SearchableSelect></label>
        <label className="text-sm font-medium">Statement start<input className="input mt-1 w-full" type="date" value={form.start} onChange={e=>setForm({...form,start:e.target.value})}/></label>
        <label className="text-sm font-medium">Statement end<input className="input mt-1 w-full" type="date" value={form.end} onChange={e=>setForm({...form,end:e.target.value})}/></label>
        <label className="text-sm font-medium">Opening statement balance<input className="input mt-1 w-full text-right" type="number" step="0.01" value={form.opening} onChange={e=>setForm({...form,opening:e.target.value})}/></label>
        <label className="text-sm font-medium">Closing statement balance<input className="input mt-1 w-full text-right" type="number" step="0.01" value={form.closing} onChange={e=>setForm({...form,closing:e.target.value})}/></label>
        <label className="text-sm font-medium">Notes<input className="input mt-1 w-full" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
      </div>
      <div className="mt-4 text-right"><button className="btn btn-primary" disabled={!form.account_id||busy==="create"} onClick={createRecon}>{busy==="create"?"Creating...":"Start Reconciliation"}</button></div>
    </div>}

    {active&&<div className="card mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <b data-report-filter-value data-report-filter-label="Bank Account">{active.account?.name}</b>
          <div className="text-xs text-slate-500"><span data-report-filter-value data-report-filter-label="Statement Period">{formatDate(active.statement_start)} to {formatDate(active.statement_end)}</span> • <span data-report-filter-value data-report-filter-label="Status">{active.status}</span></div>
          {active.notes&&<div className="mt-1 text-xs text-slate-500" data-report-filter-value data-report-filter-label="Notes">{active.notes}</div>}
        </div>
        {active.status==="draft"?<div className="no-print flex items-center gap-2" data-no-export>
          <label className="text-xs">Cleared date <input className="input ml-1" type="date" min={active.statement_start} max={active.statement_end} value={clearedDate} onChange={e=>setClearedDate(e.target.value)}/></label>
          <button className="btn btn-secondary text-red-600" onClick={cancelRecon}><Trash2 size={15}/>Cancel</button>
        </div>:<div className="text-xs text-slate-500">Closed{active.closed_at?` ${formatDate(active.closed_at)}`:""}</div>}
      </div>

      <div className="grid grid-cols-2 gap-3 border-b bg-slate-50 p-4 md:grid-cols-6" data-export-summary>
        <Metric label="Opening Statement" value={active.opening_statement_balance}/>
        <Metric label="Calculated Statement" value={active.calculated_statement_balance}/>
        <Metric label="Closing Statement" value={active.closing_statement_balance}/>
        <Metric label="Book Balance" value={active.book_balance}/>
        <Metric label="Difference" value={active.difference} danger={Math.abs(active.difference)>.009}/>
        <div><div className="text-xs text-slate-500">Outstanding</div><div className="font-bold">{outstanding.length}</div></div>
      </div>

      <div className="overflow-x-auto">
        <div className="sr-only" data-export-table-title>Bank Transactions</div>
        <table className="table"><thead><tr><th>Clear</th><th>Date</th><th>Description</th><th className="text-right">Receipt (Dr)</th><th className="text-right">Payment (Cr)</th><th>Cleared Date</th></tr></thead><tbody>{rows.length?rows.map(r=>{const item=items.find(i=>i.ledger_id===r.id&&i.reconciliation_id===active.id);return <tr key={r.id}><td>{active.status==="draft"?<input type="checkbox" checked={!!item} disabled={busy===r.id} onChange={e=>void toggle(r,e.target.checked)}/>:item?"Cleared":"Outstanding"}</td><td>{formatDate(r.entry_date)}</td><td>{r.description||"—"}</td><td className="text-right">{r.debit?money(r.debit):"—"}</td><td className="text-right">{r.credit?money(r.credit):"—"}</td><td>{item?formatDate(item.cleared_date):"Outstanding"}</td></tr>}):<tr><td colSpan={6} className="py-8 text-center text-slate-500">No bank transactions available.</td></tr>}</tbody></table>
      </div>
      {active.status==="draft"&&<div className="no-print flex justify-end border-t p-4" data-no-export><button className="btn btn-primary" disabled={Math.abs(active.difference)>.009||busy==="close"} onClick={closeRecon}><CheckCircle2 size={16}/>{busy==="close"?"Closing...":"Close & Lock"}</button></div>}
    </div>}

    <div className="card overflow-hidden">
      <div className="border-b px-5 py-3 font-semibold">Reconciliation History</div>
      <div className="overflow-x-auto"><div className="sr-only" data-export-table-title>Reconciliation History</div><table className="table"><thead><tr><th>Bank</th><th>Period</th><th>Status</th><th className="text-right">Statement Balance</th><th className="text-right">Difference</th><th></th></tr></thead><tbody>{recs.length?recs.map(r=><tr key={r.id}><td>{r.account?.name}</td><td>{formatDate(r.statement_start)} – {formatDate(r.statement_end)}</td><td><span className={r.status==="closed"?"badge badge-success":"badge badge-warning"}>{r.status}</span></td><td className="text-right">{money(r.closing_statement_balance)}</td><td className="text-right">{money(r.difference)}</td><td><button className="btn btn-secondary no-print" data-no-export onClick={()=>void loadDetails(r)}>Open</button></td></tr>):<tr><td colSpan={6} className="py-8 text-center text-slate-500">No reconciliations yet.</td></tr>}</tbody></table></div>
    </div>
  </div>;
}

function Metric({label,value,danger=false}:{label:string;value:number;danger?:boolean}){return <div><div className="text-xs text-slate-500" data-summary-label>{label}</div><div className={`font-bold ${danger?"text-red-600":""}`} data-summary-value>{money(value)}</div></div>}
