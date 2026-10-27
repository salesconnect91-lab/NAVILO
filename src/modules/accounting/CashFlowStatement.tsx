import {useEffect,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {accountingLocalDate} from '@/lib/accountingLocalDate';
import NaviloDateInput from '@/components/NaviloDateInput';
import ConfigurableReport from '../transport/ConfigurableReport';
import AccountingReportScopeSelect,{type AccountingReportScope} from './AccountingReportScopeSelect';
import DailyCashClosing from './DailyCashClosing';

type CashFlowResponse={
  opening:number|string; closing:number|string; movement:number|string; difference:number|string;
  rows:Array<{category:string;vouchers:number|string;amount:number|string}>;
};
function isCashFlowReport(value:unknown):value is CashFlowResponse{
  if(!value||typeof value!=='object')return false;
  const x=value as Record<string,unknown>;
  return ['opening','closing','movement','difference'].every(k=>x[k]!=null&&Number.isFinite(Number(x[k])))
    &&Array.isArray(x.rows)&&x.rows.every(r=>r&&typeof r==='object'
      &&typeof r.category==='string'&&Number.isFinite(Number(r.vouchers))&&Number.isFinite(Number(r.amount)));
}
const names:Record<string,string>={operating:'Operating activities',investing:'Investing activities',financing:'Financing activities',unclassified:'Unclassified / mixed vouchers'};

export default function CashFlowStatement(){
  const {activeCompany,activeBusinessUnit}=useAuth();
  const company=activeCompany?.company_id??'';
  const businessUnit=activeBusinessUnit?.business_unit_id??'';
  const [view,setView]=useState<'statement'|'daily'>('statement');
  const [scope,setScope]=useState<AccountingReportScope>('branch');
  const [from,setFrom]=useState(()=>accountingLocalDate(new Date(new Date().getFullYear(),0,1)));
  const [to,setTo]=useState(()=>accountingLocalDate());
  const [reload,setReload]=useState(0);
  const [response,setResponse]=useState<{key:string;report:CashFlowResponse}|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const key=[company,businessUnit,scope,from,to,reload].join('|');
  const report=response?.key===key?response.report:null;

  useEffect(()=>{
    let live=true;
    setResponse(null);setError('');setLoading(true);
    if(!company||!businessUnit){
      setError('Select an active company and business unit to view cash flow.');
      setLoading(false);
      return()=>{live=false};
    }
    if(!from||!to||from>to){
      setError('Valid From and To dates required.');
      setLoading(false);
      return()=>{live=false};
    }
    void supabase.rpc('accounting_cash_flow_report_scoped',{p_from:from,p_to:to,p_scope:scope}).then(({data,error:rpcError})=>{
      if(!live)return;
      if(rpcError||!isCashFlowReport(data)){
        setResponse(null);
        setError(rpcError?.message??'Incomplete cash flow evidence; totals withheld.');
      }else setResponse({key,report:data});
      setLoading(false);
    },failure=>{
      if(!live)return;
      setResponse(null);
      setError(failure instanceof Error?failure.message:'Unable to load cash flow');
      setLoading(false);
    });
    return()=>{live=false};
  },[company,businessUnit,from,to,scope,reload,key]);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold">Cash Flow Statement</h1>
      <div className="flex gap-2">
        <button className={view==='statement'?'btn-primary':'btn'} onClick={()=>setView('statement')}>Cash Flow</button>
        <button className={view==='daily'?'btn-primary':'btn'} onClick={()=>setView('daily')}>Daily Closing</button>
      </div>
    </div>
    {view==='daily'?<DailyCashClosing/>:<>
      <p className="text-xs">Direct method · Posted cash and bank movements. Transfers between cash/bank accounts cancel out. Non-cash transactions are excluded. Mixed or unknown account classifications are shown separately for review.</p>
      <div className="flex flex-wrap items-end gap-2">
        <AccountingReportScopeSelect value={scope} onChange={setScope}/>
        <label>From<NaviloDateInput className="input" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>To<NaviloDateInput className="input" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <button className="btn" onClick={()=>setReload(n=>n+1)} disabled={loading}>Refresh</button>
      </div>
      {error&&<p role="alert" className="text-red-700">{error}</p>}
      {loading?<p role="status">Loading posted cash flow…</p>:!error&&report&&<>
        <ConfigurableReport module="accounting" preferenceKey={company+':'+businessUnit+':cash-flow'} report={{
          title:'Cash Flow Statement',
          description:(activeCompany?.company_name||'')+' / '+(activeBusinessUnit?.business_unit_name||'')+' · '+from+' to '+to+' · Company base currency · Reconciliation difference '+Number(report.difference).toFixed(2),
          columns:['Activity','Posted vouchers','Cash movement'],
          rows:[
            ['Opening cash and bank','',Number(report.opening)],
            ...['operating','investing','financing','unclassified'].map(category=>{
              const r=report.rows.find(x=>x.category===category);
              return [names[category],Number(r?.vouchers??0),Number(r?.amount??0)];
            }),
            ['TOTAL / Net change','',Number(report.movement)],
            ['Closing cash and bank','',Number(report.closing)]
          ]
        }} getRowLinks={(sourceRow)=>{
          const activity=String(sourceRow[0]??'');
          if(!Object.values(names).includes(activity))return [];
          const params=new URLSearchParams({from,to});
          return [{label:'Review posted entries for this period in General Ledger',href:`/accounting/ledgers?${params.toString()}`}];
        }}/>
        {Math.abs(Number(report.difference))>=0.005&&<p role="alert">Cash flow does not reconcile to the posted ledger. Review the canonical journals and account mappings.</p>}
        <p className="text-xs">Open Accounting → Day Book or General Ledger to inspect the source vouchers. Unclassified amounts remain in the cash reconciliation.</p>
      </>}
    </>}
  </div>;
}
