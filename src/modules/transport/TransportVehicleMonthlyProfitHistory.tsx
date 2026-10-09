import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';

type ProfitRow={
  vehicle_id:string;vehicle_no:string;month:string;
  historical_net:number|string;posted_revenue:number|string;posted_cost:number|string;
  net_profit:number|string;source_kind:'historical_opening'|'posted_operations';
};
const amount=(n:number)=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const monthName=(iso:string)=>new Date(iso+'T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});

/**
 * Historical cutover rows are attribution of an EXISTING posted GL, not newly
 * recognized income. Later months are calculated from posted service/payroll
 * contributions. The server suppresses overlapping operating profit when an
 * authoritative historical opening snapshot exists for a vehicle/month.
 */
export default function TransportVehicleMonthlyProfitHistory(){
  const {activeCompany,activeBusinessUnit}=useAuth();
  const [from,setFrom]=useState(''),[to,setTo]=useState('');
  const [version,setVersion]=useState(0);
  const [rows,setRows]=useState<ProfitRow[]>([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');

  useEffect(()=>{
    let mounted=true;
    setLoading(true);setError('');setRows([]);
    void supabase.rpc('transport_vehicle_monthly_profit_report',{
      p_from:from?from+'-01':null,p_to:to?to+'-01':null,
    }).then(({data,error:failure})=>{
      if(!mounted)return;
      if(failure)throw failure;
      setRows((data??[]) as ProfitRow[]);
    }).catch((failure:unknown)=>{
      if(mounted)setError(failure instanceof Error?failure.message:String(failure));
    }).finally(()=>{if(mounted)setLoading(false)});
    return()=>{mounted=false};
  },[activeCompany?.company_id,activeBusinessUnit?.business_unit_id,from,to,version]);

  const months=useMemo(()=>{
    const byMonth=new Map<string,ProfitRow[]>();
    for(const r of rows){
      const items=byMonth.get(r.month)??[];
      items.push(r);byMonth.set(r.month,items);
    }
    return [...byMonth.entries()].sort((a,b)=>b[0].localeCompare(a[0]));
  },[rows]);

  return <section className="rounded-lg border border-slate-200 bg-white p-3 text-[12px]" aria-label="Monthly company-owned vehicle profit history">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-bold">Company Vehicles · Monthly Profit History</h3>
        <p className="text-slate-600">One row per owned vehicle/month. August cutover profit is linked to its existing posted journal; later months use posted vehicle revenue and costs.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">From month<input aria-label="Vehicle profit from month" className="input h-8 text-xs" type="month" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label className="grid gap-1">To month<input aria-label="Vehicle profit to month" className="input h-8 text-xs" type="month" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <button className="btn btn-secondary h-8 text-xs" onClick={()=>setVersion(x=>x+1)} disabled={loading}>Refresh</button>
      </div>
    </div>
    <p className="mt-2 text-slate-500">Net profit is analytical history, not a cash balance or new journal. Owner/partner transfers must be posted as separate approved journals. If historical opening and posted activity overlap, the opening NET is counted once.</p>
    {from&&to&&from>to?<p role="alert" className="mt-2 text-red-700">From month must not follow To month.</p>:
    error?<p role="alert" className="mt-2 text-red-700">{error}</p>:
    loading?<p role="status" className="mt-2">Loading monthly vehicle history…</p>:
    months.length===0?<p className="mt-2 text-slate-600">No recorded vehicle profit for this period. A missing posted contribution is not assumed to be a zero-profit month.</p>:
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left tabular-nums">
        <thead className="bg-slate-100 text-slate-700"><tr>
          <th className="p-2">Month</th><th className="p-2">Company Vehicle</th>
          <th className="p-2 text-right">Historical Opening NET</th>
          <th className="p-2 text-right">Posted Revenue</th><th className="p-2 text-right">Posted Cost</th>
          <th className="p-2 text-right">Monthly Profit / (Loss)</th><th className="p-2">Basis</th>
        </tr></thead>
        <tbody>
          {months.map(([month,items])=><>
            {items.map(r=><tr key={month+':'+r.vehicle_id} className="border-b border-slate-100">
              <td className="p-2">{monthName(month)}</td><td className="p-2 font-semibold">{r.vehicle_no}</td>
              <td className="p-2 text-right">{r.source_kind==='historical_opening'?amount(Number(r.historical_net)):'—'}</td>
              <td className="p-2 text-right">{amount(Number(r.posted_revenue))}</td>
              <td className="p-2 text-right">{amount(Number(r.posted_cost))}</td>
              <td className={'p-2 text-right font-semibold '+(Number(r.net_profit)<0?'text-red-700':'')}>{amount(Number(r.net_profit))}</td>
              <td className="p-2">{r.source_kind==='historical_opening'?'Posted opening journal':'Posted operations'}</td>
            </tr>)}
            <tr key={month+':total'} className="border-b border-slate-200 bg-slate-50 font-bold">
              <td className="p-2">{monthName(month)}</td><td className="p-2">Fleet total</td>
              <td className="p-2 text-right">{amount(items.reduce((sum,r)=>sum+(r.source_kind==='historical_opening'?Number(r.historical_net):0),0))}</td>
              <td className="p-2 text-right">{amount(items.reduce((sum,r)=>sum+Number(r.posted_revenue),0))}</td>
              <td className="p-2 text-right">{amount(items.reduce((sum,r)=>sum+Number(r.posted_cost),0))}</td>
              <td className="p-2 text-right">{amount(items.reduce((sum,r)=>sum+Number(r.net_profit),0))}</td><td className="p-2">Not distributed</td>
            </tr>
          </>)}
        </tbody>
      </table>
    </div>}
  </section>;
}
