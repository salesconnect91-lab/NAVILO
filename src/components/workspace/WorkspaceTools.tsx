import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Search, Plus, X } from "lucide-react";
import { useWorkspaceCatalog } from "./WorkspaceCatalog";

export default function WorkspaceTools(){
  const {entries,quick}=useWorkspaceCatalog();const [mode,setMode]=useState<"search"|"create"|null>(null);const [query,setQuery]=useState("");
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement|null>(null),input=useRef<HTMLInputElement>(null);const location=useLocation();
  const close=()=>{if(dialog.current?.open)dialog.current.close();setMode(null);setQuery("");trigger.current?.focus()};
  useEffect(()=>{close()},[location.pathname,location.search]);
  useEffect(()=>{if(mode){dialog.current?.showModal();input.current?.focus()}},[mode]);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setMode("search")}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler)},[]);
  const results=(mode==="create"?quick:entries).filter(e=>(e.label+' '+e.group+' '+e.key).toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="workspace-tools" data-no-print>
    <button type="button" className="workspace-search-trigger" onClick={e=>{trigger.current=e.currentTarget;setMode("search")}} aria-label="Search NAVILO functions"><Search size={15}/><span>Search functions…</span><kbd>Ctrl K</kbd></button>
    {quick.length>0&&<button type="button" className="btn-primary workspace-create" onClick={e=>{trigger.current=e.currentTarget;setMode("create")}}><Plus size={15}/><span>Create</span></button>}
    <dialog ref={dialog} className="workspace-command" aria-labelledby="workspace-command-title" onCancel={e=>{e.preventDefault();close()}} onClick={e=>{if(e.target===dialog.current)close()}}>
      <div className="workspace-command-header"><h2 id="workspace-command-title">{mode==="create"?"Quick Create":"Search NAVILO"}</h2><button type="button" className="btn" aria-label="Close function search" onClick={close}><X size={16}/></button></div>
      <label className="sr-only" htmlFor="workspace-command-search">Search functions</label><input ref={input} id="workspace-command-search" className="input w-full" placeholder="Function or report name…" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="workspace-command-results" aria-live="polite">{results.map(e=><Link key={e.key} to={e.to} onClick={close}><strong>{e.label}</strong><span>{e.group}</span></Link>)}{results.length===0&&<p>No matching functions in this workspace.</p>}</div>
    </dialog>
  </div>
}
