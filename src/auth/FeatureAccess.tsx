import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { FEATURE_BY_KEY, FEATURE_REGISTRY, matchFeatureForPath, type FeatureAction } from "@/config/featureRegistry";

type Entitlement = { feature_key:string; enabled:boolean; action_overrides:Record<string,boolean> };
type FeatureAccessContextValue = {
  loading:boolean;
  refresh:()=>Promise<void>;
  isFeatureEnabled:(featureKey:string, action?:FeatureAction)=>boolean;
};

const FeatureAccessContext=createContext<FeatureAccessContextValue|undefined>(undefined);

export function FeatureAccessProvider({children}:{children:ReactNode}){
  const { activeCompany, activeBusinessUnit }=useAuth();
  const scope=`${activeCompany?.company_id??""}:${activeBusinessUnit?.business_unit_id??""}`;
  const requestId=useRef(0);
  const [rules,setRules]=useState<{scope:string;company:Map<string,Entitlement>;unit:Map<string,Entitlement>;valid:boolean}|null>(null);
  const loading=Boolean(activeCompany)&&(!rules||rules.scope!==scope);

  const refresh=useCallback(async()=>{
    const companyId=activeCompany?.company_id;
    const currentRequest=++requestId.current;
    if(!companyId){setRules(null);return;}
    setRules(null);
    const [companyResult,unitResult]=await Promise.all([
      supabase.from("company_feature_entitlements").select("feature_key,enabled,action_overrides").eq("company_id",companyId),
      activeBusinessUnit?.business_unit_id
        ? supabase.from("business_unit_feature_entitlements").select("feature_key,enabled,action_overrides").eq("company_id",companyId).eq("business_unit_id",activeBusinessUnit.business_unit_id)
        : Promise.resolve({data:[],error:null} as {data:Entitlement[];error:null}),
    ]);
    if(currentRequest!==requestId.current)return;
    setRules({scope,valid:!companyResult.error&&!unitResult.error,
      company:new Map(((companyResult.data??[]) as Entitlement[]).map(x=>[x.feature_key,x])),
      unit:new Map(((unitResult.data??[]) as Entitlement[]).map(x=>[x.feature_key,x]))});
  },[activeCompany?.company_id,activeBusinessUnit?.business_unit_id,scope]);

  useEffect(()=>{void refresh()},[refresh]);

  const isFeatureEnabled=useCallback((featureKey:string,action:FeatureAction="view")=>{
    if(!activeCompany||!rules?.valid||rules.scope!==scope)return false;
    const feature=FEATURE_BY_KEY.get(featureKey);
    if(!feature)return false;
    if(!feature.actions.includes(action))return false;
    if(feature.businessUnitTypes?.length&&activeBusinessUnit&&!feature.businessUnitTypes.includes(activeBusinessUnit.business_unit_type))return false;
    if(feature.module!=="dashboard"){
      if(activeCompany?.enabled_modules&&!activeCompany.enabled_modules.includes(feature.module))return false;
      if(activeBusinessUnit&&!activeBusinessUnit.enabled_modules.includes(feature.module))return false;
    }
    const companyRule=rules.company.get(featureKey);
    if((companyRule?.enabled??feature.defaultEnabled??true)===false)return false;
    if(companyRule?.action_overrides&&companyRule.action_overrides[action]===false)return false;
    const unitRule=rules.unit.get(featureKey);
    if(unitRule?.enabled===false)return false;
    if(unitRule?.action_overrides&&unitRule.action_overrides[action]===false)return false;
    return true;
  },[activeBusinessUnit,activeCompany,rules,scope]);

  const value=useMemo(()=>({loading,refresh,isFeatureEnabled}),[loading,refresh,isFeatureEnabled]);
  return <FeatureAccessContext.Provider value={value}>{children}</FeatureAccessContext.Provider>;
}

export function useFeatureAccess(){
  const context=useContext(FeatureAccessContext);
  if(!context) throw new Error("useFeatureAccess must be used within FeatureAccessProvider");
  return context;
}

/**
 * Feature-aware leaf screens can use this without making isolated component tests
 * depend on the application provider. Production is wrapped by FeatureAccessProvider;
 * outside it we preserve legacy component behaviour rather than weakening runtime rules.
 */
export function useOptionalFeatureAccess(){
  return useContext(FeatureAccessContext);
}

export function FeaturePathGuard({children}:{children:ReactNode}){
  const {pathname}=useLocation();
  const {loading,isFeatureEnabled}=useFeatureAccess();
  if(pathname.startsWith("/owner"))return <>{children}</>;
  if(loading)return <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">Checking feature access…</div>;
  const feature=matchFeatureForPath(pathname);
  if(!feature)return <Navigate to="/" replace/>;
  if(isFeatureEnabled(feature.key,"view"))return <>{children}</>;
  const fallback=FEATURE_REGISTRY.find(candidate=>candidate.route!=="/"&&isFeatureEnabled(candidate.key,"view"))?.route??"/owner";
  return <Navigate to={fallback} replace/>;
}
