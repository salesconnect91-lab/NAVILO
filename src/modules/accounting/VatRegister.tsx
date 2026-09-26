import SearchableSelect from "@/components/SearchableSelect";
import { useCallback,useEffect,useMemo,useState } from "react";
import { Download,Printer,RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner,LoadingState,PageHeader,formatDate } from "@/components/ui";
import { getJurisdictionProfile } from "@/lib/jurisdictionConfig";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";

type Entry={id:string;entry_no:string;entry_date:string;trans_type:string|null;party_name:string|null;description:string|null};
type Line={entry_id:string;account_id:string;debit:number|string;credit:number|string};
const csv=(v:unknown)=>`"${String(v??"").replace(/"/g,'""')}"`;

export default function VatRegister(){
 const y=new Date().getFullYear();const[from,setFrom]=useState(`${y}-01-01`),[to,setTo]=useState(new Date().toISOString().slice(0,10));
 const[entries,setEntries]=useState<Entry[]>([]),[lines,setLines]=useState<Line[]>([]),[inputId,setInputId]=useState(""),[outputId,setOutputId]=useState("");
 const[countryCode,setCountryCode]=useState<string|null>(null),[currency,setCurrency]=useState("USD");
 const[loading,setLoading]=useState(true),[error,setError]=useState(""),[type,setType]=useState<"all"|"input"|"output">("all"),[search,setSearch]=useState("");
 const jurisdiction=getJurisdictionProfile(countryCode);
 const money=(v:number)=>new Intl.NumberFormat(jurisdiction.locale,{minimumFractionDigits:2,maximumFractionDigits:2}).format(v||0);
 const amount=(v:number)=>`${currency} ${money(v)}`;
 const load=useCallback(async()=>{setLoading(true);setError("");const settings=await supabase.from("company_settings").select("country_code,currency").maybeSingle();if(settings.error){setError(settings.error.message);setLoading(false);return;}setCountryCode(settings.data?.country_code||null);setCurrency(settings.data?.currency||getJurisdictionProfile(settings.data?.country_code).currency);const m=await supabase.from("account_mappings").select("mapping_key,account_id").in("mapping_key",["input_vat","output_vat"]);if(m.error){setError(m.error.message);setLoading(false);return;}const map=new Map((m.data??[]).map((x:any)=>[x.mapping_key,x.account_id]));const inp=String(map.get("input_vat")||""),out=String(map.get("output_vat")||"");setInputId(inp);setOutputId(out);if(!inp&&!out){setError(`${getJurisdictionProfile(settings.data?.country_code).inputTaxLabel} and ${getJurisdictionProfile(settings.data?.country_code).outputTaxLabel} mappings are not configured.`);setEntries([]);setLines([]);setLoading(false);return;}let ee:Entry[]=[];
try{
  ee=await fetchAllPages<Entry>((fromRow,toRow)=>
    supabase.from("journal_entries")
      .select("id,entry_no,entry_date,trans_type,party_name,description")
      .eq("status","posted")
      .gte("entry_date",from)
      .lte("entry_date",to)
      .order("entry_date",{ascending:false})
      .order("entry_no",{ascending:false})
      .order("id",{ascending:false})
      .range(fromRow,toRow)
  );
}catch(err){
  setError(err instanceof Error?err.message:"Unable to load VAT entries.");
  setLoading(false);return;
}

setEntries(ee);

if(!ee.length){
  setLines([]);
  setLoading(false);
  return;
}

const ids=[inp,out].filter(Boolean);

try{
  const lr=await fetchByIdChunks<Line>(
    ee.map(x=>x.id),
    (entryIds,fromRow,toRow)=>
      supabase.from("journal_lines")
        .select("entry_id,account_id,debit,credit")
        .in("entry_id",entryIds)
        .in("account_id",ids)
        .order("entry_id",{ascending:true})
        .range(fromRow,toRow)
  );

  setLines(lr);
}catch(err){
  setError(err instanceof Error?err.message:"Unable to load VAT lines.");
  setLines([]);
}setLoading(false)},[from,to]);
 useEffect(()=>{void load()},[load]);
 const em=useMemo(()=>new Map(entries.map(e=>[e.id,e])),[entries]);
 const rows=useMemo(()=>lines.map((l,i)=>{const e=em.get(l.entry_id);const kind=l.account_id===outputId?"output":"input";const debit=Number(l.debit)||0,credit=Number(l.credit)||0;const value=kind==="output"?credit-debit:debit-credit;return{id:`${l.entry_id}-${i}`,kind,e,debit,credit,amount:value}}).filter(r=>{const q=search.trim().toLowerCase();return(type==="all"||r.kind===type)&&(!q||[r.e?.entry_no,r.e?.trans_type,r.e?.party_name,r.e?.description].filter(Boolean).join(" ").toLowerCase().includes(q))}),[lines,em,outputId,type,search]);
 const totals=useMemo(()=>rows.reduce((a,r)=>{if(r.kind==="output")a.output+=r.amount;else a.input+=r.amount;return a},{output:0,input:0}),[rows]);const net=totals.output-totals.input;
 const exportCsv=()=>{const all=[["Date","Voucher",`${jurisdiction.taxLabel} Type`,"Transaction Type","Party","Description","Debit","Credit",`${jurisdiction.taxLabel} Net`],...rows.map(r=>[r.e?.entry_date||"",r.e?.entry_no||"",r.kind==="output"?jurisdiction.outputTaxLabel:jurisdiction.inputTaxLabel,r.e?.trans_type||"",r.e?.party_name||"",r.e?.description||"",r.debit.toFixed(2),r.credit.toFixed(2),r.amount.toFixed(2)])];const b=new Blob([all.map(x=>x.map(csv).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=`${jurisdiction.taxRegisterLabel.replace(/\s+/g,"-")}-${from}-to-${to}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u)};
 if(loading)return <LoadingState/>;return <div className="print-report space-y-4"><PageHeader title={`${jurisdiction.taxRegisterLabel} & Reconciliation`} subtitle={`Posted General Ledger ${jurisdiction.taxLabel} transactions for ${jurisdiction.name}. Statutory reference: ${jurisdiction.authorityLabel}. Internal tax account mappings remain stable while display terminology follows the selected country.`}/>{error&&<ErrorBanner message={error}/>}<div className="card flex flex-wrap items-end gap-3 p-4 print:hidden"><label className="text-xs font-semibold">From<input className="input mt-1" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-xs font-semibold">To<input className="input mt-1" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><SearchableSelect className="input w-auto" value={type} onChange={e=>setType(e.target.value as any)}><option value="all">All {jurisdiction.taxLabel}</option><option value="output">{jurisdiction.outputTaxLabel}</option><option value="input">{jurisdiction.inputTaxLabel}</option></SearchableSelect><input className="input min-w-56 flex-1" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search voucher, party, transaction..."/><button className="btn btn-secondary" onClick={()=>void load()}><RefreshCw size={14}/>Refresh</button><button className="btn btn-secondary" onClick={exportCsv}><Download size={14}/>CSV</button><button className="btn btn-secondary" onClick={()=>window.print()}><Printer size={14}/>Print / PDF</button></div><div className="grid gap-3 md:grid-cols-3"><div className="summary-card"><div className="summary-label">{jurisdiction.outputTaxLabel}</div><div className="summary-value">{amount(totals.output)}</div></div><div className="summary-card"><div className="summary-label">{jurisdiction.inputTaxLabel}</div><div className="summary-value">{amount(totals.input)}</div></div><div className="summary-card"><div className="summary-label">{net>=0?`Net ${jurisdiction.taxLabel} Payable`:`Net ${jurisdiction.taxLabel} Refundable`}</div><div className="summary-value">{amount(Math.abs(net))}</div></div></div><div className="card overflow-x-auto"><table className="table w-full"><thead><tr><th>Date</th><th>Voucher</th><th>{jurisdiction.taxLabel} Type</th><th>Transaction</th><th>Party</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">{jurisdiction.taxLabel} Net</th></tr></thead><tbody>{rows.length?rows.map(r=><tr key={r.id}><td>{r.e?formatDate(r.e.entry_date):"ΓÇö"}</td><td className="font-semibold">{r.e?.entry_no||"ΓÇö"}</td><td><span className={`badge ${r.kind==="output"?"bg-blue-50 text-blue-700":"bg-emerald-50 text-emerald-700"}`}>{r.kind==="output"?jurisdiction.outputTaxLabel:jurisdiction.inputTaxLabel}</span></td><td>{r.e?.trans_type||"ΓÇö"}</td><td>{r.e?.party_name||"ΓÇö"}</td><td className="max-w-md">{r.e?.description||"ΓÇö"}</td><td className="text-right">{money(r.debit)}</td><td className="text-right">{money(r.credit)}</td><td className="text-right font-bold">{money(r.amount)}</td></tr>):<tr><td colSpan={9} className="py-10 text-center text-slate-500">No {jurisdiction.taxLabel} postings for selected period/filter.</td></tr>}</tbody><tfoot><tr className="bg-slate-50 font-bold"><td colSpan={6}>FILTERED TOTAL</td><td className="text-right">ΓÇö</td><td className="text-right">ΓÇö</td><td className="text-right">Output {money(totals.output)} ┬╖ Input {money(totals.input)}</td></tr></tfoot></table></div></div>
}
