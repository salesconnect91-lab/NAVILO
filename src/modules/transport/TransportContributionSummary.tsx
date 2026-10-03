import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import ConfigurableReport from './ConfigurableReport';
export default function TransportContributionSummary({from,to}:{from:string;to:string}){
 const {activeCompany,activeBusinessUnit}=useAuth();const [rows,setRows]=useState<any[]>([]);const [error,setError]=useState('');
 useEffect(()=>{let live=true;setError('');void supabase.rpc('transport_contribution_summary',{p_from:from||null,p_to:to||null}).then(({data,error})=>{if(live){setRows(data||[]);if(error)setError(error.message)}});return()=>{live=false}},[from,to,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const revenue=rows.reduce((s,r)=>s+Number(r.revenue),0);const profit=rows.reduce((s,r)=>s+Number(r.profit),0);
 return <section className="rounded border bg-white p-3 text-xs"><h2 className="font-semibold">Transport contribution · Own fleet / Supplier vehicles</h2><p>Posted service and payroll contributions by historical ownership at trip date. This analysis is already included in the ledger P&amp;L below; do not add it again. Unattributed history remains separate. Payroll viewing permission is needed for payroll costs.</p>{error?<p role="alert">{error}</p>:<ConfigurableReport preferenceKey={`${activeCompany?.company_id}:transport-contribution`} report={{title:'Transport ownership comparison',description:`${from} to ${to} · Company base currency, excluding VAT · Only entries with saved vehicle attribution`,columns:['Ownership','Trips','Revenue','Cost','Contribution','Margin %','Revenue share %','Contribution share %'],rows:rows.map(r=>[r.ownership==='company'?'Company-owned vehicles':r.ownership==='third_party'?'Supplier vehicles':'Unattributed',Number(r.trips),Number(r.revenue),Number(r.cost),Number(r.profit),Number(r.revenue)?Number(r.profit)/Number(r.revenue)*100:0,revenue?Number(r.revenue)/revenue*100:0,profit?Number(r.profit)/profit*100:0])}}/>}</section>;
}
