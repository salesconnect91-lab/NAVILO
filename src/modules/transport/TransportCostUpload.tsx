import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {type FinancialTrip,financialNumber} from './transportFinancialTypes';
type Row={trip_id:string;trip_no:string;amount:number;date:string;reference:string;error:string};
export default function TransportCostUpload({trips,onChanged}:{trips:FinancialTrip[];onChanged:()=>Promise<void>}){
 const {activeCompany,activeBusinessUnit}=useAuth();const [rows,setRows]=useState<Row[]>([]);const [requestId,setRequestId]=useState('');const [supplier,setSupplier]=useState('');const [account,setAccount]=useState('');
 const [suppliers,setSuppliers]=useState<Array<{id:string;name:string}>>([]);const [accounts,setAccounts]=useState<Array<{id:string;name:string}>>([]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [allowed,setAllowed]=useState(false);const [withTax,setWithTax]=useState(false);
 useEffect(()=>{let live=true;setAllowed(false);setRows([]);setRequestId('');setSupplier('');setAccount('');const company=activeCompany?.company_id;if(!company)return;
 void Promise.all([
  fetchAllPages<{id:string;name:string}>((from,to)=>supabase.from('suppliers').select('id,name').eq('company_id',company).eq('is_active',true).order('id').range(from,to)),
  fetchAllPages<{id:string;name:string}>((from,to)=>supabase.from('chart_of_accounts').select('id,name').eq('company_id',company).eq('type','expense').eq('is_group',false).eq('is_active',true).order('id').range(from,to)),
  supabase.rpc('transport_finance_allowed',{p_action:'cost'})
 ]).then(([s,a,p])=>{if(p.error)throw p.error;if(live){setSuppliers(s);setAccounts(a);setAllowed(p.data===true)}}).catch(e=>{if(live)setError(e.message)});
 return()=>{live=false};},[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 async function parse(file:File){setError('');setRows([]);try{
  const XLSX=await import('xlsx');const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
  const data=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets[workbook.SheetNames[0]],{defval:''});
  if(!data.length||data.length>500)throw new Error('Upload 1 to 500 cost rows per batch.');
  const parsed=data.map(r=>{const no=String(r['Trip No']??'').trim();const trip=trips.find(t=>t.trip_no===no);const amount=Number(r.Amount);const date=String(r.Date??'').trim();
   return {trip_id:trip?.id??'',trip_no:no,amount,date,reference:String(r.Reference??'').trim(),error:!trip?'Trip not found in active workspace':!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>0.000001?'Positive amount with up to two decimals required':!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date?'Valid date must be YYYY-MM-DD':''};});
  setRows(parsed);setRequestId(crypto.randomUUID());
 }catch(e){setError(e instanceof Error?e.message:'Unable to read upload')}}
 async function post(){setBusy(true);setError('');try{
  const result=await supabase.rpc('transport_post_cost_chunk',{p_request_id:requestId,p_rows:rows.map(r=>({trip_id:r.trip_id,amount:r.amount,date:r.date,reference:r.reference})),p_supplier_id:supplier,p_cost_account_id:account,p_with_tax:withTax});
  if(result.error)throw result.error;setRows([]);await onChanged();
 }catch(e){setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Posting failed')}finally{setBusy(false)}}
 return <section className="rounded-lg border bg-white p-3 text-xs"><h2 className="mb-2 font-semibold">Driver Expense Upload</h2><p className="mb-3">Upload CSV or Excel with columns: Trip No, Amount, Date (YYYY-MM-DD), Reference. Amounts exclude VAT. Review rows before creating supplier expense bills.</p>
 {error&&<p role="alert" className="mb-2 text-red-700">{error}</p>}
 <div className="flex flex-wrap items-center gap-2"><label>File <input type="file" accept=".csv,.xlsx,.xls" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void parse(f);e.target.value=''}}/></label><label>Payable to <select className="input" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">Supplier / reimbursement party</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Expense account <select className="input" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label><input type="checkbox" checked={withTax} onChange={e=>setWithTax(e.target.checked)}/> With VAT</label><button className="btn-primary" disabled={busy||!allowed||!supplier||!account||!rows.length||rows.some(r=>r.error)} onClick={()=>void post()}>{busy?'Posting…':'Post Reviewed Costs'}</button></div>
 <table className="mt-3 w-full text-left"><thead><tr><th>Trip</th><th>Amount excluding VAT</th><th>Date</th><th>Reference</th><th>Validation</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-t"><td>{r.trip_no}</td><td>{financialNumber(r.amount)}</td><td>{r.date}</td><td>{r.reference}</td><td className={r.error?'text-red-700':'text-emerald-700'}>{r.error||'Ready'}</td></tr>)}</tbody></table></section>;
}
