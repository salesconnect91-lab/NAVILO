import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { FEATURE_REGISTRY, featureCatalogPayload, type FeatureAction, type FeatureDefinition } from "@/config/featureRegistry";

type Unit={id:string;name:string;code:string;unit_type:string;is_active:boolean};
type Rule={feature_key:string;enabled:boolean;action_overrides:Record<string,boolean>};
const actionLabel:Record<FeatureAction,string>={view:"View",create:"Create",edit:"Edit",post:"Post",delete:"Delete",print:"Print",export:"Export"};
const moduleLabel:Record<string,string>={dashboard:"Dashboard",master:"Master Data",sales:"Sales",purchase:"Purchase",inventory:"Inventory",production:"Production / Cutting",transport:"Transport",accounting:"Accounting",reports:"Reports",settings:"Settings"};

export default function OwnerFeatureControl({companyId}:{companyId:string}){
  const [units,setUnits]=useState<Unit[]>([]);
  const [companyRules,setCompanyRules]=useState<Map<string,Rule>>(new Map());
  const [unitRules,setUnitRules]=useState<Map<string,Rule>>(new Map());
  const [scope,setScope]=useState("company");
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    const sync=await supabase.rpc("sync_platform_feature_catalog",{p_features:featureCatalogPayload()});
    if(sync.error){setError(sync.error.message);setLoading(false);return;}
    const [u,c]=await Promise.all([
      supabase.from("business_units").select("id,name,code,unit_type,is_active").eq("company_id",companyId).order("is_default",{ascending:false}).order("name"),
      supabase.from("company_feature_entitlements").select("feature_key,enabled,action_overrides").eq("company_id",companyId),
    ]);
    if(u.error||c.error){setError(u.error?.message||c.error?.message||"Could not load feature governance.");setLoading(false);return;}
    const nextUnits=(u.data??[]) as Unit[];setUnits(nextUnits);
    setCompanyRules(new Map(((c.data??[]) as Rule[]).map(x=>[x.feature_key,x])));
    if(scope!=="company"&&!nextUnits.some(x=>x.id===scope))setScope("company");
    setLoading(false);
  },[companyId,scope]);

  const loadUnitRules=useCallback(async()=>{
    if(scope==="company"){setUnitRules(new Map());return;}
    const result=await supabase.from("business_unit_feature_entitlements").select("feature_key,enabled,action_overrides").eq("business_unit_id",scope);
    if(result.error){setError(result.error.message);return;}
    setUnitRules(new Map(((result.data??[]) as Rule[]).map(x=>[x.feature_key,x])));
  },[scope]);

  useEffect(()=>{void load()},[companyId]);
  useEffect(()=>{void loadUnitRules()},[loadUnitRules]);

  const selectedUnit=units.find(x=>x.id===scope)??null;
  const visible=useMemo(()=>FEATURE_REGISTRY.filter(f=>{
    if(selectedUnit&&f.businessUnitTypes?.length&&!f.businessUnitTypes.includes(selectedUnit.unit_type))return false;
    const q=query.trim().toLowerCase();
    return !q||f.label.toLowerCase().includes(q)||f.key.toLowerCase().includes(q)||f.module.toLowerCase().includes(q);
  }),[query,selectedUnit]);
  const grouped=useMemo(()=>Object.entries(visible.reduce<Record<string,FeatureDefinition[]>>((acc,f)=>{(acc[f.module]??=[]).push(f);return acc},{})),[visible]);

  const ruleFor=(feature:FeatureDefinition)=>scope==="company"?companyRules.get(feature.key):unitRules.get(feature.key);
  const companyEnabled=(feature:FeatureDefinition)=>companyRules.get(feature.key)?.enabled??feature.defaultEnabled??true;
  const enabledFor=(feature:FeatureDefinition)=>{
    if(scope==="company")return companyEnabled(feature);
    if(!companyEnabled(feature))return false;
    return unitRules.get(feature.key)?.enabled??true;
  };
  const actionEnabled=(feature:FeatureDefinition,action:FeatureAction)=>{
    if(!enabledFor(feature))return false;
    const companyOverride=companyRules.get(feature.key)?.action_overrides?.[action];
    if(companyOverride===false)return false;
    if(scope==="company")return true;
    const unitOverride=unitRules.get(feature.key)?.action_overrides?.[action];
    return unitOverride!==false;
  };

  const saveRule=async(feature:FeatureDefinition,enabled:boolean,actionOverrides:Record<string,boolean>)=>{
    setSaving(feature.key);setError("");
    const {error:e}=await supabase.rpc("set_feature_entitlement",{
      p_company_id:companyId,p_business_unit_id:scope==="company"?null:scope,p_feature_key:feature.key,p_enabled:enabled,p_action_overrides:actionOverrides,
    });
    if(e){setError(e.message);setSaving("");return;}
    const next:Rule={feature_key:feature.key,enabled,action_overrides:actionOverrides};
    if(scope==="company")setCompanyRules(current=>new Map(current).set(feature.key,next));else setUnitRules(current=>new Map(current).set(feature.key,next));
    setSaving("");
  };

  const toggleFeature=(feature:FeatureDefinition)=>{
    const current=ruleFor(feature);
    const nextEnabled=!enabledFor(feature);
    void saveRule(feature,nextEnabled,current?.action_overrides??{});
  };
  const toggleAction=(feature:FeatureDefinition,action:FeatureAction)=>{
    const current=ruleFor(feature);
    const overrides={...(current?.action_overrides??{})};
    overrides[action]=!actionEnabled(feature,action);
    void saveRule(feature,enabledFor(feature),overrides);
  };

  if(loading)return <section className="rounded-xl border bg-white p-4 shadow-sm"><Loader2 className="h-5 w-5 animate-spin"/></section>;
  return <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 text-indigo-700"/><div><h2 className="font-semibold text-slate-900">Advanced Feature Governance</h2><p className="text-xs text-slate-500">Central registry for modules, functions and reports. New registered NAVILO features appear here automatically. Company rules apply first; business-unit rules can only restrict further.</p></div></div><button className="btn-secondary" onClick={()=>void load()}><RefreshCw className="h-4 w-4"/>Sync Registry</button></div>
    {error&&<div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    <div className="mt-4 grid gap-3 lg:grid-cols-[280px_1fr]">
      <label className="text-xs font-semibold text-slate-700">Control Scope<select className="input mt-1 w-full" value={scope} onChange={e=>setScope(e.target.value)}><option value="company">Company-wide baseline</option>{units.filter(x=>x.is_active).map(u=><option key={u.id} value={u.id} data-search={u.code}>{u.name}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-700">Find Feature<div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input className="input w-full pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search invoices, reports, accounting, stock…"/></div></label>
    </div>
    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><strong>Strict rule:</strong> disabling a feature blocks its route and hides it from licensed use; disabling an action blocks that action in the feature entitlement layer. Core Dashboard cannot be disabled. A business unit cannot re-enable a feature disabled at company level.</div>
    <div className="mt-4 space-y-3">{grouped.map(([module,features])=><details key={module} open={module==="reports"||module==="accounting"} className="rounded-xl border border-slate-200"><summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-slate-800">{moduleLabel[module]??module} <span className="ml-2 text-xs font-normal text-slate-400">{features.length} features</span></summary><div className="border-t border-slate-100 p-3"><div className="space-y-2">{features.map(feature=>{const enabled=enabledFor(feature);const companyBlocked=scope!=="company"&&!companyEnabled(feature);return <div key={feature.key} className={`rounded-lg border p-3 ${enabled?"border-slate-200":"border-amber-200 bg-amber-50/40"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold text-slate-900">{feature.label}{feature.coreLocked&&<span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase text-slate-500">Core locked</span>}</div><div className="text-[11px] text-slate-400">{feature.key} · {feature.category} · {feature.route}</div></div><label className="flex items-center gap-2 text-xs font-semibold"><span>{enabled?"Enabled":"Disabled"}</span><input type="checkbox" checked={enabled} disabled={saving===feature.key||feature.coreLocked||companyBlocked} onChange={()=>toggleFeature(feature)}/></label></div><div className="mt-2 flex flex-wrap gap-2">{feature.actions.map(action=><label key={action} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${actionEnabled(feature,action)?"bg-white text-slate-700":"bg-slate-100 text-slate-400"}`}><input type="checkbox" checked={actionEnabled(feature,action)} disabled={saving===feature.key||!enabled||companyBlocked} onChange={()=>toggleAction(feature,action)}/>{actionLabel[action]}</label>)}</div>{companyBlocked&&<div className="mt-2 text-[11px] font-medium text-amber-700">Disabled at company level — this business unit cannot override it.</div>}</div>})}</div></div></details>)}</div>
  </section>;
}
