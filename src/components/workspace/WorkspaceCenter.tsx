import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Star, ArrowUpRight, Search } from "lucide-react";
import { useWorkspaceCatalog, type CatalogEntry } from "./WorkspaceCatalog";

export default function WorkspaceCenter(){
  const {entries,favorites,recent,toggleFavorite}=useWorkspaceCatalog();const {pathname}=useLocation();const [query,setQuery]=useState("");const [group,setGroup]=useState("All");
  const mode=pathname.split('/')[2];const title=({reports:"Reports Center",imports:"Import Center",favorites:"Favorites",recent:"Recent Pages"} as Record<string,string>)[mode]??"All Functions";
  let available=mode==="reports"?entries.filter(e=>e.report):mode==="favorites"?entries.filter(e=>favorites.includes(e.key)):mode==="recent"?recent.flatMap(k=>entries.filter(e=>e.key===k)):entries;
  const groups=["All",...new Set(available.map(e=>e.group))];
  const filtered=available.filter(e=>(group==="All"||!groups.includes(group)||e.group===group)&&(e.label+' '+e.group+' '+e.key).toLowerCase().includes(query.toLowerCase()));
  return <section className="workspace-center" data-navilo-catalog="true"><header className="workspace-page-heading"><div><h1>{title}</h1><p>{mode==="reports"?"Financial statements, operational reports and business insights.":mode==="imports"?"Choose the existing workflow for the records you want to bring in.":"Your permitted functions, organized in one place."}</p></div></header>
    {mode==="imports"?<ImportDirectory canOpen={entries.some(e=>e.key==="import-center")} />:<>
    <div className="workspace-catalog-toolbar"><label><Search size={16}/><input aria-label={`Search ${title}`} placeholder={`Search ${title.toLowerCase()}…`} value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="workspace-category-list" aria-label="Function categories">{groups.map(g=><button type="button" key={g} aria-pressed={g===group} onClick={()=>setGroup(g)}>{g}</button>)}</div></div>
    <p className="workspace-result-count" role="status">{filtered.length} {mode==="reports"?"reports":"functions"}</p><div className="workspace-catalog-grid">{filtered.map(e=><article key={e.key} className="workspace-catalog-card"><Link to={e.to}><span>{e.group}</span><strong>{e.label}</strong><ArrowUpRight size={16}/></Link><button type="button" onClick={()=>toggleFavorite(e.key)} aria-label={`${favorites.includes(e.key)?"Remove":"Add"} ${e.label} ${favorites.includes(e.key)?"from":"to"} favorites`} aria-pressed={favorites.includes(e.key)}><Star size={16} fill={favorites.includes(e.key)?"currentColor":"none"}/></button></article>)}</div>{filtered.length===0&&<p className="workspace-empty">{mode==="favorites"?"Star a function in All Functions or Reports Center to keep it here.":"No matching functions in this workspace."}</p>}</>}
  </section>
}
const importTasks=[
  {key:"expense-bills",name:"Expense invoices — with or without VAT",effect:"Non-inventory supplier bills",to:"/settings/imports?section=expense",module:"purchase"},
  {key:"cash-expenses",name:"Office / Yard Direct Cash Expenses Excel",effect:"No supplier account • atomic posted vouchers after database approval",to:"/settings/imports?section=cash-expenses",module:"accounting"},
  {key:"masters",name:"Customers & suppliers",effect:"Master records",to:"/settings/imports?section=masters",module:"master"},
  {key:"rates",name:"Transport masters & rates",effect:"Master records and agreed rates",to:"/settings/imports?section=rates",module:"transport"},
  {key:"trips",name:"Daily trip upload",effect:"Trip records only",to:"/settings/imports?section=trips",module:"transport"},
  {key:"service",name:"Service invoices & ready invoices",effect:"Validate and import drafts",to:"/settings/imports?section=service",module:"transport"},
  {key:"normal",name:"Sale / Purchase — without trips",effect:"Independent draft invoices",to:"/settings/imports?section=normal",module:"transport"},
  {key:"money",name:"Receipts, payments & journals",effect:"Payments post; journals start as drafts",to:"/settings/imports?section=accounting",module:"accounting"},
  {key:"transfer",name:"One-time records & transfer",effect:"Controlled one-time workflow",to:"/settings/imports?section=history",module:"transport"},
];
function ImportDirectory({canOpen}:{canOpen:boolean}){
  const {importModules}=useWorkspaceCatalog();
  const [query,setQuery]=useState("");const tasks=importTasks.filter(t=>importModules.includes(t.module)&&(t.name+' '+t.effect).toLowerCase().includes(query.toLowerCase()));
  if(!canOpen)return <p className="workspace-empty">Import Center is unavailable for this workspace.</p>;
  return <><div className="workspace-catalog-toolbar"><label><Search size={16}/><input aria-label="Search imports" placeholder="Search imports…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="workspace-catalog-grid">{tasks.map(t=><article key={t.key} className="workspace-catalog-card"><Link to={t.to}><span>{t.effect}</span><strong>{t.name}</strong><ArrowUpRight size={16}/></Link></article>)}</div>{!tasks.length&&<p>No matching import workflows.</p>}</>;
}
export function WorkspaceShortcuts(){const {entries,favorites,recent}=useWorkspaceCatalog();const chosen=[...new Set([...favorites,...recent])].slice(0,6).flatMap(k=>entries.filter(e=>e.key===k));return <section className="workspace-shortcuts" data-no-print><div><strong>Your workspace</strong><Link to="/workspace/functions">All functions <ArrowUpRight size={13}/></Link></div><nav aria-label="Workspace shortcuts">{chosen.length?chosen.map(e=><Link key={e.key} to={e.to}>{e.label}</Link>):<><Link to="/workspace/favorites">Favorites</Link><Link to="/workspace/recent">Recent pages</Link></>}</nav></section>}
