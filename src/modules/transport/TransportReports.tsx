import {useState} from 'react';
import {Navigate,useSearchParams} from 'react-router-dom';
import NaviloDateInput from '@/components/NaviloDateInput';
import TransportPartyReports from './TransportPartyReports';
import TransportAccountStatement from './TransportAccountStatement';
import TransportTripReports from './TransportTripReports';
import TransportContributionSummary from './TransportContributionSummary';

type Mode='party'|'driver'|'vehicle'|'trips'|'profit';
const validModes=new Set<Mode>(['party','driver','vehicle','trips','profit']);

export default function TransportReports(){
 const [params,setParams]=useSearchParams();
 const requested=params.get('mode') as Mode|null;
 const mode:Mode=requested&&validModes.has(requested)?requested:'party';
 const requestedSide=params.get('side')==='supplier'?'supplier':'customer';
 const [from,setFrom]=useState('');const [to,setTo]=useState(new Date().toISOString().slice(0,10));
 function choose(next:Mode,side?:'customer'|'supplier'){
   const q=new URLSearchParams(params);q.set('mode',next);
   if(next==='party')q.set('side',side??requestedSide);else q.delete('side');
   setParams(q,{replace:false});
 }
 if(mode==='driver')return <Navigate to="/master-data/employees" replace/>;
 return <div className="space-y-3"><h1 className="text-xl font-bold">Transport Reports</h1>
 <p className="text-xs text-slate-600">Company / Business Unit scoped Transport reporting. Financial reports use canonical posted Sales, Purchase and accounting evidence; operational reports do not create accounting entries.</p>
 <div className="flex flex-wrap gap-2">
  <button className={mode==='party'&&requestedSide==='customer'?'btn-primary':'btn'} onClick={()=>choose('party','customer')}>Customer reports</button>
  <button className={mode==='party'&&requestedSide==='supplier'?'btn-primary':'btn'} onClick={()=>choose('party','supplier')}>Supplier reports</button>
  <button className={mode==='vehicle'?'btn-primary':'btn'} onClick={()=>choose('vehicle')}>Company Vehicle / Gari Hisaab</button>
  <button className={mode==='trips'?'btn-primary':'btn'} onClick={()=>choose('trips')}>Trip-wise reports</button>
  <button className={mode==='profit'?'btn-primary':'btn'} onClick={()=>choose('profit')}>Posted profitability</button>
 </div>
 {mode==='party'&&<TransportPartyReports key={requestedSide} initialSide={requestedSide} onClose={()=>choose('trips')} onChanged={async()=>{}}/>}
 {mode==='vehicle'&&<TransportAccountStatement kind="vehicle"/>}
 {mode==='trips'&&<TransportTripReports/>}
 {mode==='profit'&&<><div className="flex gap-2"><label>Comparison: posting date From<NaviloDateInput className="input" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Comparison: posting date To<NaviloDateInput className="input" value={to} onChange={e=>setTo(e.target.value)}/></label></div>{from&&to&&from>to?<p role="alert">From must be on or before To.</p>:<TransportContributionSummary from={from} to={to}/>}</>}
 </div>;
}
