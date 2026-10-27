import {useEffect,useRef,useState} from 'react';
import SearchableSelect from '@/components/SearchableSelect';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import {formatNaviloDate} from '@/lib/naviloDate';
import ConfigurableReport from './ConfigurableReport';
import type {ReportTable} from './transportPartyExport';
export default function TransportVehicleAccountingReport(){
 const {activeCompany,activeBusinessUnit}=useAuth();const c=activeCompany?.company_id,b=activeBusinessUnit?.business_unit_id,scope=`${c}/${b}`;
 const ledgerCache=useRef<{key:string;rows:any[];revenue:number;cost:number}|null>(null);
 const [vehicles,setVehicles]=useState<{id:string;vehicle_no:string}[]>([]),[vehicle,setVehicle]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState<ReportTable|null>(null),[mode,setMode]=useState('ledger');const selection=`${scope}/${vehicle}/${from}/${to}/${mode}`;const [loaded,setLoaded]=useState('');
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
   // Vehicle accounting ledger: present movements as normal debits and credits.
   const ledgerKey=JSON.stringify([c,b,vehicle,from,to]);
   const cached=ledgerCache.current?.key===ledgerKey?ledgerCache.current:null;
   let revenue=cached?.revenue??0,cost=cached?.cost??0;
   const rows:any[]=cached?.rows??[];
   if(!cached){
    let count:number|null=null;
    for(let offset=0;;offset+=100){const r=await supabase.rpc('transport_vehicle_ledger',{p_vehicle:vehicle,p_from:from||null,p_to:to||null,p_limit:100,p_offset:offset});if(r.error)throw new Error(/failed to fetch|timeout|network|520/i.test(r.error.message||'')?'Vehicle ledger server request timed out. Your accounting records are unchanged. Try a shorter date range; if it persists, the database query needs optimization.':r.error.message);const d=r.data;if(!Number.isSafeInteger(d?.count)||d.count<0||!Array.isArray(d.rows))throw Error('Incomplete vehicle report response');if(count!==null&&(count!==d.count||revenue!==Number(d.revenue)||cost!==Number(d.cost)))throw Error('Accounting changed during loading; refresh report.');count=d.count;revenue=Number(d.revenue);cost=Number(d.cost);if(count>50000)throw Error('Narrow date range to 50,000 accounting rows or fewer.');rows.push(...d.rows);if(rows.length>=count||d.rows.length<100)break;}
    if(rows.length!==count)throw Error('Incomplete report; totals withheld.');
    if(live)ledgerCache.current={key:ledgerKey,rows,revenue,cost};
   }
   const title=`Vehicle ${vehicles.find(v=>v.id===vehicle)?.vehicle_no??''} — Ledger`;
   const description=`${activeCompany?.company_name??''} / ${activeBusinessUnit?.business_unit_name??''} · Posting dates ${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'All'} · Posted vehicle movements shown as debit and credit entries. Reversals use their posting dates.`;
   let debitTotal=0,creditTotal=0;
   const movements=rows.map(x=>{
    const revenueAmount=Number(x.revenue),costAmount=Number(x.cost);
    const debit=Math.max(costAmount,0)+Math.max(-revenueAmount,0);
    const credit=Math.max(revenueAmount,0)+Math.max(-costAmount,0);
    debitTotal+=debit;creditTotal+=credit;
    const particulars=[x.category,x.expense_accounts].filter(Boolean).join(' · ');
    return [formatNaviloDate(x.event_date),x.entry_no,x.trip_no||'',particulars,debit,credit];
   });
   const table:ReportTable={title,description,columns:['Date','Document','Trip No','Particulars','Debit','Credit'],rows:[
    ...movements,
    ['TOTAL · selected period','','','',debitTotal,creditTotal],
   ]};
   if(live){setReport(table);setLoaded(selection);}
  })().catch(e=>{if(live){const message=String(e?.message??'');setError(/failed to fetch|networkerror|load failed|timeout|520/i.test(message)?'Vehicle Ledger could not reach the accounting server. Your records were not changed. Try a shorter date range; if this continues, the database RPC needs optimization.':message||'Vehicle accounting report unavailable');}}).finally(()=>{if(live)setBusy(false);});return()=>{live=false};
 },[c,b,vehicle,from,to,mode,selection,vehicles,activeCompany?.company_name,activeBusinessUnit?.business_unit_name]);
 return <section className="space-y-2 rounded border bg-white p-3 text-xs"><div className="flex flex-wrap items-end gap-2"><label>Vehicle<SearchableSelect nativeCompatibility className="input block" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Select Vehicle Master</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.vehicle_no}</option>)}</SearchableSelect></label><label>{mode==='source'?'Source Invoice Date From':'Posting Date From'}<NaviloDateInput className="input block" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<NaviloDateInput className="input block" value={to} onChange={e=>setTo(e.target.value)}/></label><label>Statement<SearchableSelect nativeCompatibility className="input block" value={mode} onChange={e=>setMode(e.target.value)}><option value="ledger">Vehicle Ledger · Debit / Credit</option><option value="source">Source-linked Trip Billings (separate)</option></SearchableSelect></label></div>{from&&to&&from>to&&<p role="alert">From must be on or before To.</p>}{busy&&<p role="status">Loading vehicle ledger…</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}{report&&loaded===selection&&!busy&&!error&&<ConfigurableReport report={report} preferenceKey={`vehicle-accounting-${scope}-${mode}`}/>}</section>;
}
