import {useState} from 'react';
import NaviloDateInput from '@/components/NaviloDateInput';
import TransportPartyReports from './TransportPartyReports';
import TransportAccountStatement from './TransportAccountStatement';
import TransportTripReports from './TransportTripReports';
import TransportContributionSummary from './TransportContributionSummary';
export default function TransportReports(){
 const [mode,setMode]=useState<'party'|'driver'|'vehicle'|'profit'>('party');const [from,setFrom]=useState('');const [to,setTo]=useState(new Date().toISOString().slice(0,10));
 return <div className="space-y-3"><h1 className="text-xl font-bold">Transport Reports</h1><div className="flex flex-wrap gap-2">{([['party','Customer and Supplier'],['driver','Driver statement'],['vehicle','Vehicle statement'],['profit','Posted Trip profitability']] as const).map(([key,label])=><button className={mode===key?'btn-primary':'btn'} key={key} onClick={()=>setMode(key)}>{label}</button>)}</div>
 {mode==='party'&&<TransportPartyReports onClose={()=>setMode('profit')} onChanged={async()=>{}}/>}{mode==='driver'&&<TransportAccountStatement kind="driver"/>}{mode==='vehicle'&&<TransportAccountStatement kind="vehicle"/>}
 {mode==='profit'&&<><div className="flex gap-2"><label>Comparison: posting date From<NaviloDateInput className="input" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Comparison: posting date To<NaviloDateInput className="input" value={to} onChange={e=>setTo(e.target.value)}/></label></div>{from&&to&&from>to?<p role="alert">From must be on or before To.</p>:<TransportContributionSummary from={from} to={to}/>}<TransportTripReports/></>}</div>;
}
