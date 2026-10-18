import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import ConfigurableReport from '../transport/ConfigurableReport';
import {fetchAllPages,fetchByIdChunks} from '@/lib/fetchAllPages';
import {accountingLocalDate} from '@/lib/accountingLocalDate';
type Entry={id:string;entry_no:string;entry_date:string;description:string|null;status:string};
type Line={id:string;entry_id:string;debit:number;credit:number;account:string|null;coa?:{name:string;type:string;detail_type:string|null}|null};
type CashSummary={opening:number|string;closing:number|string;movement:number|string;difference:number|string};
type CashData={key:string;entries:Entry[];lines:Line[];summary:CashSummary};
const isCash=(l:Line)=>{
  const detail=(l.coa?.detail_type||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return l.coa?.type==='asset'&&['cashonhand','cashandcashequivalents','cash','bank','bankaccount','cashandcashequivalent'].includes(detail);
};
const validCashSummary=(s:unknown):s is CashSummary=>{
  if(!s||typeof s!=='object')return false;
  const o=s as Record<string,unknown>;
  return ['opening','closing','movement','difference'].every(k=>o[k]!=null&&Number.isFinite(Number(o[k])));
};
export default function DailyCashClosing(){
  const {activeCompany,activeBusinessUnit}=useAuth();
  const company=activeCompany?.company_id??'',businessUnit=activeBusinessUnit?.business_unit_id??'';
  const [date,setDate]=useState(()=>accountingLocalDate());
  const [reload,setReload]=useState(0);
  const [state,setState]=useState<CashData|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const key=[company,businessUnit,date,reload].join('|');
  const data=state?.key===key?state:null;

  useEffect(()=>{
    let live=true;
    setState(null);setLoading(true);setError('');
    if(!company||!businessUnit||!date){
      setError('Active company, business unit and closing date required.');
      setLoading(false);
      return()=>{live=false};
    }
    (async()=>{
      try{
        const {data:loc,error:locationError}=await supabase.rpc('current_operating_location_id');
        if(locationError)throw locationError;
        if(!loc||typeof loc!=='string')throw new Error('Active operating branch required.');
        const [{data:summary,error:summaryError},entries]=await Promise.all([
          supabase.rpc('accounting_cash_flow_report_scoped',{p_from:date,p_to:date,p_scope:'branch'}),
          fetchAllPages<Entry>((from,to)=>supabase.from('journal_entries')
            .select('id,entry_no,entry_date,description,status')
            .eq('company_id',company)
            .eq('business_unit_id',businessUnit)
            .eq('operating_location_id',loc)
            .eq('status','posted')
            .eq('entry_date',date)
            .order('entry_no').range(from,to))
        ]);
        if(summaryError)throw summaryError;
        if(!validCashSummary(summary))throw new Error('Incomplete posted cash flow evidence; totals withheld.');
        if(!Array.isArray(entries))throw new Error('Incomplete posted vouchers; totals withheld.');
        if(!live)return;
        const ids=entries.map(x=>x.id);
        const lines=ids.length?await fetchByIdChunks<Line>(ids,(chunk,from,to)=>
          supabase.from('journal_lines')
            .select('id,entry_id,debit,credit,account,coa:chart_of_accounts(name,type,detail_type)')
            .eq('company_id',company)
            .eq('business_unit_id',businessUnit)
            .eq('operating_location_id',loc)
            .in('entry_id',chunk)
            .order('id').range(from,to) as any):[];
        if(!Array.isArray(lines))throw new Error('Incomplete voucher line details; totals withheld.');
        if(live)setState({key,entries,lines,summary});
      }catch(e){
        if(live){setState(null);setError(e instanceof Error?e.message:(typeof e==='object'&&e!==null&&'message' in e&&typeof e.message==='string'?e.message:'Unable to load daily closing'));}
      }finally{if(live)setLoading(false);}
    })();
    return()=>{live=false};
  },[company,businessUnit,date,reload,key]);

  const rows=useMemo(()=>{
    const by=new Map<string,Line[]>();
    (data?.lines??[]).forEach(l=>by.set(l.entry_id,[...(by.get(l.entry_id)||[]),l]));
    return (data?.entries??[]).flatMap(entry=>{
      const voucherLines=by.get(entry.id)||[];
      const cash=voucherLines.filter(isCash);
      const movement=cash.reduce((sum,l)=>sum+Number(l.debit||0)-Number(l.credit||0),0);
      if(Math.abs(movement)<0.005)return [];
      const accounts=[...new Set(cash.map(l=>l.coa?.name||l.account||'Cash / Bank'))].join(' / ');
      const counter=[...new Set(voucherLines.filter(l=>!isCash(l)&&(Number(l.debit||0)||Number(l.credit||0))).map(l=>l.coa?.name||l.account||'Unlinked'))].join(' / ');
      return [[entry.entry_no,movement>0?'RECEIPT':'PAYMENT',entry.description||counter,counter,accounts,movement>0?movement:0,movement<0?-movement:0]];
    });
  },[data]);

  const received=rows.reduce((sum,row)=>sum+Number(row[5]||0),0);
  const paid=rows.reduce((sum,row)=>sum+Number(row[6]||0),0);
  const opening=Number(data?.summary.opening??0);
  const closing=Number(data?.summary.closing??0);
  const net=Number(data?.summary.movement??0);
  const difference=net-(received-paid);
  const report={
    title:'Daily Cash / Bank Closing',
    description:(activeCompany?.company_name??'')+' / '+(activeBusinessUnit?.business_unit_name??'')+' · '+date
      +' · Posted branch vouchers only · Opening '+opening.toFixed(2)+' · Received '+received.toFixed(2)
      +' · Paid '+paid.toFixed(2)+' · Closing '+closing.toFixed(2),
    columns:['Voucher','Type','Party / Purpose / Reference','Counter Account','Cash / Bank Account','Money In','Money Out'],
    rows:[...rows,['TOTAL','','','','',received,paid]],
  };
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm font-semibold">Closing date<NaviloDateInput className="input" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <button className="btn" disabled={loading} onClick={()=>setReload(n=>n+1)}>Refresh</button>
      {!loading&&!error&&data&&<div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs">
        <b>Opening:</b> {opening.toFixed(2)} · <b>In:</b> {received.toFixed(2)}
        {' · '}<b>Out:</b> {paid.toFixed(2)} · <b>Closing:</b> {closing.toFixed(2)}
      </div>}
    </div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {loading?<p role="status">Loading daily closing…</p>:!error&&data&&<>
      <ConfigurableReport module="accounting" preferenceKey={company+':'+businessUnit+':daily-cash-closing'} report={report}/>
      {Math.abs(difference)>=0.005&&<p role="alert">Daily voucher movements differ from the posted branch cash flow by {difference.toFixed(2)}. Verify voucher details before relying on closing totals.</p>}
    </>}
    <p className="text-xs text-slate-500">Cash/bank transfers are excluded because their net voucher movement is zero. Print/PDF/Excel use the same posted daily evidence.</p>
  </section>;
}
