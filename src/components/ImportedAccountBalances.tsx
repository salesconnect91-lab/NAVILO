import {useEffect,useState} from 'react';
import {hasPermission} from '@/auth/permissions';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {fetchAllPages,fetchByIdChunks} from '@/lib/fetchAllPages';
import {ErrorBanner,formatCurrency,currentCurrency} from './ui';
import {exportMatrixToCSV} from '@/lib/exportUtils';

type Balance={id:string;code:string;name:string;debit:number;credit:number;closing:number};
/** Cutover accounts remain visible even before operational master linkage exists.
 * This reads the original posting and all later GL movements; it creates no
 * payroll share, lender receipt, payment, invoice or second opening journal. */
export default function ImportedAccountBalances({kind,to='',search=''}:{kind:'driver'|'loan';to?:string;search?:string}){
 const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
 const canExport=isPlatformOwner||hasPermission(activeBusinessUnit?.membership_role??activeCompany?.membership_role,"reports","export",activeBusinessUnit?.permissions??activeCompany?.permissions,false);
 const companyId=activeCompany?.company_id,unitId=activeBusinessUnit?.business_unit_id;
 const [rows,setRows]=useState<Balance[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setRows([]);setError('');setLoading(true);
 async function load(){try{
 if(!companyId)return;
 const accounts=await fetchAllPages<any>((a,b)=>supabase.from('chart_of_accounts').select('id,code,name').eq('company_id',companyId).order('id').range(a,b));
 const relevant=accounts.filter(a=>(kind==='driver'?/\bdriver\b/i:/\bloan\b/i).test(a.name));
 const entries=await fetchAllPages<any>((a,b)=>{let q=supabase.from('journal_entries').select('id').eq('company_id',companyId).eq('status','posted').eq('source_document_type','cutover_opening_balances');if(unitId)q=q.eq('business_unit_id',unitId);return q.order('id').range(a,b)});
 if(!entries.length||!relevant.length)return;
 const openingIds=new Set(entries.map(e=>e.id));
 const movements=await fetchByIdChunks<any>(relevant.map(a=>a.id),(ids,a,b)=>{let q=supabase.from('ledgers').select('id,account_id,journal_entry_id,entry_date,debit,credit').eq('company_id',companyId).in('account_id',ids);if(unitId)q=q.eq('business_unit_id',unitId);if(to)q=q.lte('entry_date',to);return q.order('id').range(a,b)});
 const balances=relevant.map(a=>{const all=movements.filter(m=>m.account_id===a.id),opening=all.filter(m=>openingIds.has(m.journal_entry_id));return {...a,debit:opening.reduce((s,m)=>s+Number(m.debit),0),credit:opening.reduce((s,m)=>s+Number(m.credit),0),closing:all.reduce((s,m)=>s+Number(m.debit)-Number(m.credit),0),hasOpening:opening.length>0}}).filter(a=>a.hasOpening);
 if(active)setRows(balances);
 }catch(e:any){if(active)setError(e.message||'Unable to load imported GL balances.')}finally{if(active)setLoading(false)}}
 void load();return()=>{active=false};
 },[companyId,unitId,kind,to]);
 const filtered=rows.filter(r=>!search||`${r.code} ${r.name}`.toLowerCase().includes(search.toLowerCase()));
 if(!loading&&!error&&!rows.length)return null;
 const matrix=[['Account','Opening Debit','Opening Credit','Closing Debit / (Credit)'],...filtered.map(r=>[`${r.code} ${r.name}`,r.debit,r.credit,r.closing])];
 return <section className="card my-4 p-4" aria-label={`Imported ${kind} GL balances`}><h2 className="font-semibold">Imported {kind==='driver'?'driver':'loan'} balances · {currentCurrency()}</h2><p className="my-2 text-sm text-slate-600">Original cutover balances and current GL balance{to?` through ${to}`:''}. These accounts are separate from operational {kind==='driver'?'payroll':'lender'} records; they are not new receipts, repayments or salary transactions.</p>{loading?<p role="status">Loading imported balances…</p>:error?<ErrorBanner message={error}/>:<>{canExport&&<button className="btn-secondary print:hidden mb-2" onClick={()=>exportMatrixToCSV(`Imported_${kind}_balances`,[['Currency',currentCurrency()],...matrix])}>Export imported balances CSV</button>}<div className="overflow-x-auto"><table className="table w-full"><thead><tr>{matrix[0].map(x=><th key={String(x)}>{x}</th>)}</tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td>{r.code} · {r.name}</td><td>{formatCurrency(r.debit)}</td><td>{formatCurrency(r.credit)}</td><td>{formatCurrency(Math.abs(r.closing))} {r.closing<0?'Cr':'Dr'}</td></tr>)}</tbody></table></div></>}</section>;
}
