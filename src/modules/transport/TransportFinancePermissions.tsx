import NaviloSearchableSelect from "@/components/SearchableSelect";
import {useEffect,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {financeActions,type TransportFinanceAction} from './transportFinancialTypes';
export default function TransportFinancePermissions({users}:{users:Array<{user_id:string;full_name?:string|null;email?:string|null}>}){
 const {activeCompany,activeBusinessUnit}=useAuth();const [selected,setSelected]=useState('');const [values,setValues]=useState<Partial<Record<TransportFinanceAction,boolean>>>({});
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const company=activeCompany?.company_id;const unit=activeBusinessUnit?.business_unit_id;
 useEffect(()=>{let live=true;setValues({});if(!company||!unit||!selected)return;
 void Promise.all([
 supabase.from('business_unit_memberships').select('role').eq('company_id',company).eq('business_unit_id',unit).eq('user_id',selected).eq('is_active',true).maybeSingle(),
 supabase.from('transport_financial_permissions').select('action,allowed').eq('company_id',company).eq('business_unit_id',unit).eq('user_id',selected)
 ]).then(([m,p])=>{if(m.error)throw m.error;if(p.error)throw p.error;if(!m.data)throw new Error('User is not an active member of this workspace.');
 const preset=['company_owner','admin'].includes(m.data.role);const next=Object.fromEntries(financeActions.map(a=>[a,preset]));for(const row of p.data??[])next[row.action]=row.allowed;if(live)setValues(next);
 }).catch(e=>{if(live)setError(e.message)});return()=>{live=false};},[company,unit,selected]);
 if(activeBusinessUnit?.business_unit_type!=='transport')return null;
 async function save(action:TransportFinanceAction,allowed:boolean){setBusy(true);setError('');try{const result=await supabase.rpc('transport_set_financial_permission',{p_user_id:selected,p_action:action,p_allowed:allowed});if(result.error)throw result.error;setValues(v=>({...v,[action]:allowed}));}catch(e){setError(e instanceof Error?e.message:'Permission update failed')}finally{setBusy(false)}}
 return <section className="rounded-lg border bg-white p-3 text-xs"><h2 className="font-semibold">Transport Financial Permissions</h2><p className="my-2">These actions supplement Transport Post and the canonical Sales / Purchase / Accounting permissions in the active workspace. Owners and administrators have the role preset; other members require explicit grants.</p>
 <label>User <NaviloSearchableSelect nativeCompatibility preserveLabel className="input" disabled={busy} value={selected} onChange={e=>{setError('');setSelected(e.target.value)}}><option value="">Select workspace user</option>{users.map(u=><option key={u.user_id} value={u.user_id}>{u.full_name||u.email||u.user_id}</option>)}</NaviloSearchableSelect></label>{error&&<p role="alert" className="mt-2 text-red-700">{error}</p>}
 <div className="mt-2 flex flex-wrap gap-3">{financeActions.map(a=><label key={a} className="capitalize"><input type="checkbox" disabled={busy||!selected||values[a]===undefined} checked={values[a]===true} onChange={e=>void save(a,e.target.checked)}/> {a}</label>)}</div></section>;
}
