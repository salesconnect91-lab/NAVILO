import {useCallback,useEffect,useMemo,useState} from "react";
import {Copy,Loader2,Mic,Plus,ShieldCheck,Smartphone} from "lucide-react";
import {supabase} from "@/lib/supabase";
import {invokeEdgeFunction} from "@/lib/invokeEdgeFunction";
import SearchableSelect from "@/components/SearchableSelect";

type Unit={id:string;name:string;code:string};
type MobileRow={user_id:string;business_unit_id:string;is_active:boolean;permissions:Record<string,any>;email:string|null;full_name:string|null};
const mobileUrl="https://navilo.vercel.app/transport/mobile";

export default function TransportMobileAccessControl({companyId}:{companyId:string}){
  const [units,setUnits]=useState<Unit[]>([]);
  const [rows,setRows]=useState<MobileRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [form,setForm]=useState({full_name:"",email:"",password:"",business_unit_id:"",can_create:true,can_edit:true});

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    const [unitResult,membershipResult]=await Promise.all([
      supabase.from("business_units").select("id,name,code").eq("company_id",companyId).eq("unit_type","transport").eq("is_active",true).order("name"),
      supabase.from("business_unit_memberships").select("user_id,business_unit_id,is_active,permissions").eq("company_id",companyId).eq("role","transport_mobile"),
    ]);
    if(unitResult.error||membershipResult.error){setError(unitResult.error?.message||membershipResult.error?.message||"Could not load mobile access.");setLoading(false);return;}
    const memberships=(membershipResult.data??[]) as any[];
    const ids=[...new Set(memberships.map(x=>x.user_id))];
    const profiles=ids.length?await supabase.from("user_profiles").select("id,email,full_name").in("id",ids):{data:[],error:null} as any;
    if(profiles.error){setError(profiles.error.message);setLoading(false);return;}
    const profileMap=new Map<string,{email:string|null;full_name:string|null}>((profiles.data??[]).map((p:any)=>[String(p.id),{email:p.email??null,full_name:p.full_name??null}]));
    setUnits((unitResult.data??[]) as Unit[]);
    setRows(memberships.map((m:any)=>({...m,...(profileMap.get(String(m.user_id))??{email:null,full_name:null})})));
    setForm(current=>({...current,business_unit_id:(unitResult.data??[]).some((u:any)=>u.id===current.business_unit_id)?current.business_unit_id:((unitResult.data??[])[0]?.id||"")}));
    setLoading(false);
  },[companyId]);

  useEffect(()=>{void load()},[load]);
  const unitMap=useMemo(()=>new Map(units.map(u=>[u.id,u])),[units]);
  const create=async()=>{
    if(!form.full_name.trim()||!form.email.trim()||form.password.length<8||!form.business_unit_id){setError("Name, email, Transport business unit and minimum 8 character temporary password are required.");return;}
    setBusy(true);setError("");setMessage("");
    try{
      await invokeEdgeFunction("platform-admin",{action:"create_user",company_id:companyId,role:"transport_mobile",full_name:form.full_name.trim(),email:form.email.trim().toLowerCase(),password:form.password,business_unit_id:form.business_unit_id,mobile_can_create:form.can_create,mobile_can_edit:form.can_edit});
      setMessage("Dedicated mobile-only login created.");
      setForm(current=>({...current,full_name:"",email:"",password:""}));
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not create mobile login.");}finally{setBusy(false);}
  };
  const update=async(row:MobileRow,patch:{is_active?:boolean;can_create?:boolean;can_edit?:boolean})=>{
    const currentCreate=row.permissions?.transport?.create===true;
    const currentEdit=row.permissions?.transport?.edit===true;
    setBusy(true);setError("");setMessage("");
    try{
      await invokeEdgeFunction("platform-admin",{action:"update_transport_mobile_access",company_id:companyId,user_id:row.user_id,is_active:patch.is_active??row.is_active,can_create:patch.can_create??currentCreate,can_edit:patch.can_edit??currentEdit});
      setMessage("Mobile-only access updated.");await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not update mobile access.");}finally{setBusy(false);}
  };

  if(loading)return <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm"><Loader2 className="h-5 w-5 animate-spin"/></section>;
  return <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-2"><Smartphone className="mt-0.5 h-5 w-5 text-blue-700"/><div><h2 className="font-semibold text-slate-900">Transport Mobile-Only Access</h2><p className="text-xs text-slate-500">Create dedicated logins that can open only Mobile Quick Entry. They cannot open Dashboard, Accounting, Reports, Settings or the desktop Transport workspace.</p></div></div>
      <button type="button" className="btn-secondary" onClick={()=>void navigator.clipboard?.writeText(mobileUrl)}><Copy className="h-4 w-4"/>Copy Mobile Link</button>
    </div>
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><ShieldCheck className="mr-1 inline h-4 w-4"/>Dedicated URL: <strong>/transport/mobile</strong> · Search is limited to the last 30 days. Voice entry creates a reviewable saved draft before posting the Trip.</div>
    {error&&<div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    {message&&<div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <input className="input" placeholder="Full name" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/>
      <input className="input" type="email" placeholder="Mobile login email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
      <input className="input" type="password" placeholder="Temporary password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
      <SearchableSelect className="input" value={form.business_unit_id} onChange={e=>setForm({...form,business_unit_id:e.target.value})}><option value="">Transport business unit</option>{units.map(u=><option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}</SearchableSelect>
      <div className="flex items-center gap-3 rounded-lg border px-3 text-xs font-semibold"><label className="flex items-center gap-1"><input type="checkbox" checked={form.can_create} onChange={e=>setForm({...form,can_create:e.target.checked})}/>Create</label><label className="flex items-center gap-1"><input type="checkbox" checked={form.can_edit} onChange={e=>setForm({...form,can_edit:e.target.checked})}/>Edit</label></div>
      <button className="btn-primary" disabled={busy||!units.length} onClick={()=>void create()}><Plus className="h-4 w-4"/>Create Mobile Login</button>
    </div>
    {!units.length&&<div className="mt-3 text-xs text-amber-700">No active Transport business unit is available for this company.</div>}
    <div className="mt-4 space-y-2">{rows.map(row=>{const canCreate=row.permissions?.transport?.create===true,canEdit=row.permissions?.transport?.edit===true;return <div key={row.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div><div className="text-sm font-semibold text-slate-900">{row.full_name||row.email||row.user_id}</div><div className="text-xs text-slate-500">{row.email||"No email"} · {unitMap.get(row.business_unit_id)?.name||"Transport"} · {row.is_active?"Active":"Disabled"}</div></div><div className="flex flex-wrap items-center gap-3 text-xs font-semibold"><label className="flex items-center gap-1"><input type="checkbox" checked={canCreate} disabled={busy||!row.is_active} onChange={e=>void update(row,{can_create:e.target.checked})}/>Create</label><label className="flex items-center gap-1"><input type="checkbox" checked={canEdit} disabled={busy||!row.is_active} onChange={e=>void update(row,{can_edit:e.target.checked})}/>Edit</label><button className="btn-secondary h-8" disabled={busy} onClick={()=>void update(row,{is_active:!row.is_active})}>{row.is_active?"Disable":"Enable"}</button></div></div>})}{!rows.length&&<div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">No dedicated Transport Mobile logins yet.</div>}</div>
    <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><Mic className="h-3.5 w-3.5"/>Voice is used only to prepare the Trip draft; the user reviews the recognized master data before the Trip is created.</div>
  </section>;
}
