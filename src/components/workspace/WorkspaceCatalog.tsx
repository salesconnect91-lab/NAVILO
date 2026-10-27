import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Star, Clock, Search, Upload, ChartNoAxesCombined } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useFeatureAccess } from "@/auth/FeatureAccess";
import { hasPermission, canTransportAction, type ModuleKey } from "@/auth/permissions";
import { FEATURE_REGISTRY, FEATURE_BY_KEY, matchFeatureForPath } from "@/config/featureRegistry";
import { navigation, filterNode, flatten, shellLabel, type NavNode } from "@/config/navigation";

export type CatalogEntry = { key: string; label: string; to: string; group: string; report: boolean; module?: ModuleKey };
export const workspacePaths = ["/workspace/functions", "/workspace/reports", "/workspace/imports", "/workspace/favorites", "/workspace/recent"];
const reportKeys = new Set(["vat-register", "day-book", "ledgers", "salesperson-ledger", "stock-aging", "transport-trip-reports"]);
export function catalogFromNavigation(nodes: NavNode[]): CatalogEntry[] {
  const seen = new Set<string>();
  return nodes.flatMap(group => flatten([group]).flatMap(node => {
    if (!node.to || seen.has(node.to)) return [];
    seen.add(node.to);
    const feature = FEATURE_BY_KEY.get(node.key);
    return [{ key: node.key, label: shellLabel(node.label), to: node.to, group: shellLabel(group.label), module: node.module,
      report: reportKeys.has(node.key) || feature?.category === "report" || feature?.category === "statement" || node.to.startsWith("/reports/") }];
  }));
}
export function readWorkspacePreferences(key: string): {favorites: string[]; recent: string[]} {
  try { const data = JSON.parse(localStorage.getItem(key) || "{}"); return {
    favorites: Array.isArray(data.favorites) ? data.favorites.filter((v: unknown) => typeof v === "string").slice(0,100) : [],
    recent: Array.isArray(data.recent) ? data.recent.filter((v: unknown) => typeof v === "string").slice(0,12) : []
  }; } catch { return {favorites:[],recent:[]}; }
}
type CatalogValue = { entries: CatalogEntry[]; navigation: NavNode[]; favorites: string[]; recent: string[]; toggleFavorite: (key:string)=>void; quick: CatalogEntry[]; importModules: string[] };
const Context = createContext<CatalogValue | null>(null);
export function WorkspaceCatalogProvider({children}:{children:ReactNode}) {
  const auth = useAuth(); const access = useFeatureAccess(); const location = useLocation();
  const {activeCompany:company,activeBusinessUnit:unit,isPlatformOwner:owner,user}=auth;
  const role=unit?.membership_role??company?.membership_role, permissions=unit?.permissions??company?.permissions;
  const mods=(unit?.enabled_modules??company?.enabled_modules??[]).filter(m=>!company?.enabled_modules||company.enabled_modules.includes(m));
  const scope=`navilo:workspace:v1:${user?.id??"anonymous"}:${company?.company_id??"none"}:${unit?.business_unit_id??"none"}`;
  const [saved,setSaved]=useState(()=>({scope,...readWorkspacePreferences(scope)}));
  const prefs=saved.scope===scope?saved:readWorkspacePreferences(scope);
  const moduleAllowed=(module:ModuleKey,action:"view"|"create"="view")=>mods.includes(module)&&hasPermission(role,module,action,permissions,owner);
  const visible=navigation.map(n=>filterNode(n,role,owner,mods,unit?.business_unit_type,permissions,key=>access.isFeatureEnabled(key,"view"))).filter(Boolean) as NavNode[];
  const entries=catalogFromNavigation(visible).filter(e=>{if(e.to.startsWith("/owner"))return owner;const feature=matchFeatureForPath(e.to.split("?")[0]);return feature&&access.isFeatureEnabled(feature.key,"view")});
  const keys=new Set(entries.map(e=>e.key));
  for(const feature of FEATURE_REGISTRY){
    if(keys.has(feature.key)||feature.key==="transport-workspace"||feature.key==="transport-vehicle-ledger"||!moduleAllowed(feature.module)||!access.isFeatureEnabled(feature.key,"view"))continue;
    // Existing navigation restrictions remain authoritative for catalogued leaves.
    if(flatten(navigation).some(n=>n.key===feature.key))continue;
    if(entries.some(e=>e.to===feature.route))continue;
    entries.push({key:feature.key,label:feature.label,to:feature.route,module:feature.module,group:feature.module==="reports"?"Reports":feature.module,report:["report","statement"].includes(feature.category)||reportKeys.has(feature.key)});
  }
  const add=(entry:CatalogEntry,modules:ModuleKey[])=>{const feature=matchFeatureForPath(entry.to.split('?')[0]);if(modules.every(m=>moduleAllowed(m))&&feature&&access.isFeatureEnabled(feature.key,"view"))entries.push(entry)};
  if(moduleAllowed("purchase","create")&&access.isFeatureEnabled("purchase-invoices","create")){
    add({key:"expense-invoice-create",label:"Expense Invoice",to:"/purchase/expense/new",module:"purchase",group:"Purchase",report:false},["purchase"]);
    add({key:"expense-invoice-import",label:"Import Expense Invoices",to:"/purchase/expense/import",module:"purchase",group:"Purchase",report:false},["purchase"]);
  }
  if(unit?.business_unit_type==="transport"){
    add({key:"vehicle-expenses",label:"Vehicle Expenses",to:"/transport/vehicle-expenses",module:"transport",group:"Transport",report:false},["transport","accounting"]);
    add({key:"vehicle-expense-types",label:"Vehicle Expense Types",to:"/master-data/vehicle-expense-types",module:"master",group:"Master Data",report:false},["master","transport"]);
  }
  // Catalog shortcuts must satisfy every module guard on their actual route.
  for(let i=entries.length-1;i>=0;i--){
    const path=entries[i].to.split('?')[0];
    const required:ModuleKey[]=path.startsWith('/reports/transport')?["reports","transport"]:path==='/reports/steel-stock'?["reports","inventory"]:path==='/reports/supplier-aging'?["reports","purchase"]:path.startsWith('/godown')?["inventory"]:[];
    if(!required.every(m=>moduleAllowed(m)))entries.splice(i,1);
  }
  const quick:CatalogEntry[]=[];
  const create=(key:string,label:string,to:string,module:ModuleKey,featureKey=key)=>{if(moduleAllowed(module,"create")&&access.isFeatureEnabled(featureKey,"create"))quick.push({key:`create-${key}`,label,to,module,group:"Quick Create",report:false})};
  create("sales-invoices","Sale Invoice",unit?.business_unit_type==="transport"?"/sales/new?type=normal":"/sales/new","sales");
  create("purchase-invoices","Purchase Invoice",unit?.business_unit_type==="transport"?"/purchase/normal/new":"/purchase/new","purchase");
  create("expense-invoice","Expense Invoice","/purchase/expense/new","purchase","purchase-invoices");
  create("journal","Journal Entry","/accounting","accounting");
  create("cash-counter","Receipt / Payment","/accounting/cash-counter","accounting");
  if(unit?.business_unit_type==="transport"&&canTransportAction(role,permissions,"trip_create",owner))create("transport-trips-register","Trip","/transport?view=new","transport");
  create("customers","Customer","/master-data/customers","master");create("suppliers","Supplier","/master-data/suppliers","master");
  const signature=entries.map(e=>e.key+e.to).join('|');
  useEffect(()=>{
    const exact=entries.find(e=>e.to===location.pathname+location.search)??entries.find(e=>e.to===location.pathname&&!location.search);
    if(!exact)return;
    setSaved(previous=>{const current=previous.scope===scope?previous:readWorkspacePreferences(scope);if(current.recent[0]===exact.key&&previous.scope===scope)return previous;const next={scope,favorites:current.favorites,recent:[exact.key,...current.recent.filter(k=>k!==exact.key)].slice(0,12)};try{localStorage.setItem(scope,JSON.stringify({favorites:next.favorites,recent:next.recent}))}catch{/* Browser storage can be unavailable. */}return next});
  },[location.pathname,location.search,scope,signature]);
  const toggleFavorite=(key:string)=>{if(!entries.some(e=>e.key===key))return;setSaved(previous=>{const current=previous.scope===scope?previous:readWorkspacePreferences(scope);const next={scope,recent:current.recent,favorites:current.favorites.includes(key)?current.favorites.filter(k=>k!==key):[...current.favorites,key].slice(-100)};try{localStorage.setItem(scope,JSON.stringify({favorites:next.favorites,recent:next.recent}))}catch{/* Optional preference storage. */}return next})};
  const centers:NavNode[]=[{key:"workspace-favorites",label:"Favorites",to:"/workspace/favorites",icon:Star},{key:"workspace-recent",label:"Recent Pages",to:"/workspace/recent",icon:Clock},{key:"workspace-functions",label:"All Functions",to:"/workspace/functions",icon:Search}];
  if(entries.some(e=>e.report))centers.push({key:"workspace-reports",label:"Reports Center",to:"/workspace/reports",icon:ChartNoAxesCombined});
  if(entries.some(e=>e.key==="import-center"))centers.push({key:"workspace-imports",label:"Import Center",to:"/workspace/imports",icon:Upload});
  const ordered=["dashboard","sales","purchase","accounting","inventory","production","cutting","transport","master","settings","owner"];
  const nav=ordered.flatMap(key=>visible.filter(n=>n.key===key)).map(n=>n.key==="settings"?{...n,children:n.children?.filter(c=>c.key!=="import-center")}:n);
  // Reports remain reachable through the unified catalog, including accounting reports.
  nav.splice(Math.min(1,nav.length),0,...centers);
  return <Context.Provider value={{entries,navigation:nav,favorites:prefs.favorites.filter(k=>entries.some(e=>e.key===k)),recent:prefs.recent.filter(k=>entries.some(e=>e.key===k)),toggleFavorite,quick,importModules:mods.filter(m=>moduleAllowed(m as ModuleKey,"create")&&(m!=="transport"||unit?.business_unit_type==="transport"))}}>{children}</Context.Provider>;
}
export function useWorkspaceCatalog(){const value=useContext(Context);if(!value)throw new Error("Workspace catalog provider required");return value}
