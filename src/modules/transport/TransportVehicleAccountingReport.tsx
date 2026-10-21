import {useEffect,useRef,useState} from 'react';
import SearchableSelect from '@/components/SearchableSelect';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import {formatNaviloDate} from '@/lib/naviloDate';
import ConfigurableReport from './ConfigurableReport';
import {groupPostedVehicleMonths} from './vehiclePostedMonthSummary';
import type {ReportTable} from './transportPartyExport';
export default function TransportVehicleAccountingReport(){
 const {activeCompany,activeBusinessUnit}=useAuth();const c=activeCompany?.company_id,b=activeBusinessUnit?.business_unit_id,scope=`${c}/${b}`;
 const ledgerCache=useRef<{key:string;rows:any[];revenue:number;cost:number}|null>(null);
 const [vehicles,setVehicles]=useState<{id:string;vehicle_no:string}[]>([]),[vehicle,setVehicle]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState<ReportTable|null>(null),[mode,setMode]=useState('monthly');const selection=`${scope}/${vehicle}/${from}/${to}/${mode}`;const [loaded,setLoaded]=useState('');
 useEffect(()=>{let live=true;setVehicles([]);setVehicle('');setReport(null);setError('');if(!c||!b)return;void (async()=>{const rows:typeof vehicles=[];for(let offset=0;;offset+=500){const r=await supabase.from('transport_vehicles').select('id,vehicle_no').eq('company_id',c).eq('business_unit_id',b).order('id').range(offset,offset+499);if(r.error)throw r.error;rows.push(...r.data??[]);if((r.data??[]).length<500)break;}if(live)setVehicles(rows);})().catch(e=>{if(live)setError(e.message);});return()=>{live=false};},[c,b,scope]);
 useEffect(()=>{let live=true;setReport(null);setLoaded('');setError('');if(!vehicle||from&&to&&from>to){setBusy(false);return;}setBusy(true);
  void (async()=>{if(mode==='source'){
    let count:number|null=null,net=0,vat=0,gross=0;
    const rows:any[]=[];
    for(let offset=0;;offset+=500){
     const r=await supabase.rpc('transport_vehicle_source_billing',{p_vehicle:vehicle,p_from:from||null,p_to:to||null,p_limit:500,p_offset:offset});
     if(r.error)throw r.error;
     const d=r.data;
     if(!Number.isSafeInteger(d?.count)||d.count<0||!Array.isArray(d.rows))throw Error('Incomplete source billing response');
     if(![d.net,d.vat,d.gross].every((n:unknown)=>Number.isFinite(Number(n))))throw Error('Invalid source billing totals');
     if(count!==null&&(count!==d.count||net!==Number(d.net)||vat!==Number(d.vat)||gross!==Number(d.gross)))throw Error('Source billing changed during loading; refresh report.');
     count=d.count;net=Number(d.net);vat=Number(d.vat);gross=Number(d.gross);
     if(count>50000)throw Error('Narrow invoice date range to 50,000 source billing rows or fewer.');
     rows.push(...d.rows);
     if(rows.length>=count||d.rows.length<500)break;
    }
    if(rows.length!==count)throw Error('Incomplete source billing report; totals withheld.');
    const name=vehicles.find(v=>v.id===vehicle)?.vehicle_no??'';
    const table:ReportTable={
     title:`Vehicle ${name} — Source-linked Trip Billings`,
     description:`${activeCompany?.company_name??''} / ${activeBusinessUnit?.business_unit_name??''} · Source invoice dates ${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'All'} · Posted, unreversed source-linked Trip invoices attributed to this vehicle. Income here is already present in company accounting and must NOT be added again to General P&L or vehicle GL. VAT separately identified. This is not a vehicle expense or net profit statement.`,
     columns:['Invoice Date','Source Invoice No','Trip No','Net Income','VAT','Gross'],
     rows:[...rows.map(x=>[formatNaviloDate(x.event_date),x.original_invoice_no||'',x.trip_no||'',Number(x.net),Number(x.vat),Number(x.gross)]),
       ['TOTAL · full filter','','',net,vat,gross]],
    };
    if(live){setReport(table);setLoaded(selection);}
    return;
   }
   // Monthly, detailed and P&L modes share one immutable snapshot for the same selection.
   const ledgerKey=JSON.stringify([c,b,vehicle,from,to]);
   const cached=ledgerCache.current?.key===ledgerKey?ledgerCache.current:null;
   let revenue=cached?.revenue??0,cost=cached?.cost??0;
   const rows:any[]=cached?.rows??[];
   if(!cached){
    let count:number|null=null;
    for(let offset=0;;offset+=500){const r=await supabase.rpc('transport_vehicle_ledger',{p_vehicle:vehicle,p_from:from||null,p_to:to||null,p_limit:500,p_offset:offset});if(r.error)throw r.error;const d=r.data;if(!Number.isSafeInteger(d?.count)||d.count<0||!Array.isArray(d.rows))throw Error('Incomplete vehicle report response');if(count!==null&&(count!==d.count||revenue!==Number(d.revenue)||cost!==Number(d.cost)))throw Error('Accounting changed during loading; refresh report.');count=d.count;revenue=Number(d.revenue);cost=Number(d.cost);if(count>50000)throw Error('Narrow date range to 50,000 accounting rows or fewer.');rows.push(...d.rows);if(rows.length>=count||d.rows.length<500)break;}
    if(rows.length!==count)throw Error('Incomplete report; totals withheld.');
    if(live)ledgerCache.current={key:ledgerKey,rows,revenue,cost};
   }
   let running=0;
   // Manual debits to a revenue account are contra-revenue in the General P&L.
   // Vehicle statement shows these journal debits separately; net profit is unchanged.
   const revenueDebits=rows.reduce((sum,x)=>sum+(x.category==='Manual journal'&&Number(x.revenue)<0?-Number(x.revenue):0),0);
   const title=`Vehicle ${vehicles.find(v=>v.id===vehicle)?.vehicle_no??''} — ${mode==='monthly'?'Monthly Income, Expenses & Net Profit':mode==='profit'?'Profit & Loss':'Accounting Ledger'}`;
   const description=`${activeCompany?.company_name??''} / ${activeBusinessUnit?.business_unit_name??''} · Posting dates ${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'All'} · Posted canonical accounting only. Recoverable VAT excluded from income/cost; non-recoverable VAT included in expense. Reversals use their posting dates. Manual debits to a revenue GL appear separately in the vehicle statement; the General P&L treats them as revenue reductions.`;
   const months=mode==='monthly'?groupPostedVehicleMonths(rows):[];
   const table:ReportTable=mode==='monthly'
    ?{title,description:description+' Monthly totals include posted income and expenses only. Unposted expenses can overstate profit. Historical opening balances are shown separately and never counted twice.',
      columns:['Month','Details','Income','Expenses','Net Profit'],
      rows:[
       ...months.flatMap(m=>[
         [m.month,'Posted Month Total',m.income,m.expenses,m.net],
         ...m.costDetails.map(cost=>['',`  ↳ ${cost.account}`,'',cost.amount,''])
       ]),
       ['TOTAL · selected period','',revenue,cost,revenue-cost]
      ]}
    :mode==='profit'
    ?{title,description,columns:['Description','Amount'],rows:[
      ['Income',revenue+revenueDebits],
      ['Expense-account costs',cost],
      ['Revenue-account debits (manual journals)',revenueDebits],
      ['Net Profit',revenue-cost],
     ]}
    :{title,description,columns:['Date','Document','Trip No','Type','Income','Expense / Account Debit','Net','Running Net'],rows:[
      ...rows.map(x=>{
       const income=Number(x.revenue),expense=Number(x.cost);
       const debit=x.category==='Manual journal'&&income<0?-income:0;
       running+=income-expense;
       return [formatNaviloDate(x.event_date),x.entry_no,x.trip_no||'',x.category,income+debit,expense+debit,income-expense,running];
      }),
      ['TOTAL · full filter','','','',revenue+revenueDebits,cost+revenueDebits,revenue-cost,revenue-cost],
     ]};
   if(live){setReport(table);setLoaded(selection);}
  })().catch(e=>{if(live)setError(e.message||'Vehicle accounting report unavailable');}).finally(()=>{if(live)setBusy(false);});return()=>{live=false};
 },[c,b,vehicle,from,to,mode,selection,vehicles,activeCompany?.company_name,activeBusinessUnit?.business_unit_name]);
 return <section className="space-y-2 rounded border bg-white p-3 text-xs"><div className="flex flex-wrap items-end gap-2"><label>Vehicle<SearchableSelect nativeCompatibility className="input block" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Select Vehicle Master</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.vehicle_no}</option>)}</SearchableSelect></label><label>{mode==='source'?'Source Invoice Date From':'Posting Date From'}<NaviloDateInput className="input block" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<NaviloDateInput className="input block" value={to} onChange={e=>setTo(e.target.value)}/></label><label>Statement<SearchableSelect nativeCompatibility className="input block" value={mode} onChange={e=>setMode(e.target.value)}><option value="monthly">Monthly Income / Expense / Profit</option><option value="ledger">Detailed Vehicle Ledger</option><option value="profit">Vehicle P&amp;L</option><option value="source">Source-linked Trip Billings (separate)</option></SearchableSelect></label></div>{from&&to&&from>to&&<p role="alert">From must be on or before To.</p>}{busy&&<p role="status">Loading complete vehicle accounting…</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}{report&&loaded===selection&&!busy&&!error&&<ConfigurableReport report={report} preferenceKey={`vehicle-accounting-${scope}-${mode}`}/>}</section>;
}
