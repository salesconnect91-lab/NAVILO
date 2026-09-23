import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Modal, PageHeader } from "@/components/ui";
import SearchableSelect from "@/components/SearchableSelect";
import { toUrduName } from "@/lib/urdu";
import { useAuth } from "@/auth/AuthContext";

type Status = "issued" | "tare_weighed" | "loading" | "weighed" | "finalized" | "cancelled";
type GP = { id:string; pass_no:string; customer_id:string|null; customer_name:string|null; vehicle_no:string|null; driver_name:string|null; token_notes:string|null; loaded_by_loader_id:string|null; loaded_by_name:string|null; tare_weight:number; gross_weight:number; net_weight:number; status:Status; pass_date:string; tare_weighbridge_reference:string|null; gross_weighbridge_reference:string|null };
type Line = { id?:string; gate_pass_id?:string; item_id:string|null; item_description:string; requested_qty:number; actual_qty:number; uom:string; warehouse_id:string|null; godown_id:string|null; remarks:string|null; warehouse?:{name:string}|null; godown?:{name:string}|null };
type Customer={id:string;name:string;name_urdu:string|null};
type Item={id:string;sku:string;name:string;name_urdu:string|null;grade:string|null;size:string|null;unit:string|null;warehouse_id:string|null};
type Uom={id:string;name:string;symbol:string};
type Warehouse={id:string;name:string;name_urdu:string|null};
type Godown={id:string;name:string;warehouse_id:string|null};
type Instruction={id:string;name_en:string;name_ur:string|null};
type Loader={id:string;name_en:string;name_ur:string|null;phone:string|null};

const emptyLine=():Line=>({item_id:null,item_description:"",requested_qty:0,actual_qty:0,uom:"kg",warehouse_id:null,godown_id:null,remarks:null});
const emptyToken=()=>({customer_id:"",customer_name:"",vehicle_no:"",driver_name:"",token_notes:"",pass_date:new Date().toISOString().slice(0,10)});
const labels:Record<Status,string>={issued:"Token Issued",tare_weighed:"1st Kanta Done",loading:"Loading Done",weighed:"2nd Kanta Done",finalized:"Final Gate Pass",cancelled:"Cancelled"};
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));

export default function GatePassWorkflow(){
  const {activeCompany,activeBusinessUnit}=useAuth();
  const [rows,setRows]=useState<GP[]>([]);
  const [lines,setLines]=useState<Record<string,Line[]>>({});
  const [customers,setCustomers]=useState<Customer[]>([]);
  const [items,setItems]=useState<Item[]>([]);
  const [uoms,setUoms]=useState<Uom[]>([]);
  const [warehouses,setWarehouses]=useState<Warehouse[]>([]);
  const [godowns,setGodowns]=useState<Godown[]>([]);
  const [instructions,setInstructions]=useState<Instruction[]>([]);
  const [loaders,setLoaders]=useState<Loader[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(true);
  const [createOpen,setCreateOpen]=useState(false);
  const [loadingOpen,setLoadingOpen]=useState(false);
  const [kantaOpen,setKantaOpen]=useState(false);
  const [loaderOpen,setLoaderOpen]=useState(false);
  const [instructionOpen,setInstructionOpen]=useState(false);
  const [selected,setSelected]=useState<GP|null>(null);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [token,setToken]=useState(emptyToken());
  const [tokenLines,setTokenLines]=useState<Line[]>([emptyLine()]);
  const [workLines,setWorkLines]=useState<Line[]>([]);
  const [loaderId,setLoaderId]=useState("");
  const [kantaStage,setKantaStage]=useState<"tare"|"gross">("tare");
  const [tare,setTare]=useState("");
  const [gross,setGross]=useState("");
  const [weighRef,setWeighRef]=useState("");
  const [instructionId,setInstructionId]=useState("");
  const [newInstruction,setNewInstruction]=useState({en:"",ur:""});
  const [newLoader,setNewLoader]=useState({en:"",ur:"",phone:""});
  const [editingLoaderId,setEditingLoaderId]=useState<string|null>(null);
  const net=Math.max((+gross||0)-(+tare||0),0);
  const documentLanguage=()=>{const root=document.documentElement.dataset;const mode=root.documentLanguageMode||"single",primary=root.documentPrimaryLanguage||"en",secondary=root.documentSecondaryLanguage||"";const en=primary==="en"||(mode==="bilingual"&&secondary==="en"),ur=primary==="ur"||(mode==="bilingual"&&secondary==="ur");return{en,ur,label:(e:string,u:string)=>mode==="bilingual"&&en&&ur?`${e} / ${u}`:ur&&!en?u:e};};

  const load=useCallback(async()=>{
    setBusy(true);setError(null);
    const [g,l,c,i,u,w,d,ins,ld]=await Promise.all([
      supabase.from("gate_passes").select("id,pass_no,customer_id,customer_name,vehicle_no,driver_name,token_notes,loaded_by_loader_id,loaded_by_name,tare_weight,gross_weight,net_weight,status,pass_date,tare_weighbridge_reference,gross_weighbridge_reference").order("created_at",{ascending:false}),
      supabase.from("gate_pass_lines").select("id,gate_pass_id,item_id,item_description,requested_qty,actual_qty,uom,warehouse_id,godown_id,remarks,warehouse:warehouses(name),godown:godowns(name)"),
      supabase.from("customers").select("id,name,name_urdu").order("name"),
      supabase.from("items").select("id,sku,name,name_urdu,grade,size,unit,warehouse_id").order("name"),
      supabase.from("uom").select("id,name,symbol").order("name"),
      supabase.from("warehouses").select("id,name,name_urdu").order("name"),
      supabase.from("godowns").select("id,name,warehouse_id").order("name"),
      supabase.from("gate_pass_loading_instructions").select("id,name_en,name_ur").eq("is_active",true).order("name_en"),
      supabase.from("gate_pass_loaders").select("id,name_en,name_ur,phone").eq("is_active",true).order("name_en")
    ]);
    const e=g.error||l.error||c.error||i.error||u.error||w.error||d.error||ins.error||ld.error;
    if(e)setError(e.message);else{
      setRows((g.data||[]) as GP[]);
      const m:Record<string,Line[]>={};
      for(const x of (l.data||[]) as any[])(m[x.gate_pass_id]??=[]).push(x);
      setLines(m);setCustomers((c.data||[]) as Customer[]);setItems((i.data||[]) as Item[]);setUoms((u.data||[]) as Uom[]);setWarehouses((w.data||[]) as Warehouse[]);setGodowns((d.data||[]) as Godown[]);setInstructions((ins.data||[]) as Instruction[]);setLoaders((ld.data||[]) as Loader[]);
    }
    setBusy(false);
  },[]);
  useEffect(()=>{void load()},[load]);

  const nextNo=useMemo(()=>{let n=0;rows.forEach(r=>{const m=r.pass_no.match(/(\d+)$/);if(m)n=Math.max(n,+m[1])});return`GP-${String(n+1).padStart(4,"0")}`},[rows]);
  const customerDisplay=(g:GP)=>{const c=customers.find(x=>x.id===g.customer_id);return[g.customer_name||c?.name,c?.name_urdu].filter(Boolean).join(" / ")||"—"};
  const lineDisplay=(x:Line)=>{const i=items.find(a=>a.id===x.item_id);return[x.item_description,i?.name_urdu].filter(Boolean).join(" / ")||"—"};
  const loaderLabel=(x:Loader)=>[x.name_en,x.name_ur].filter(Boolean).join(" / ");
  const isPreFinal=(g:GP)=>!["finalized","cancelled"].includes(g.status);

  const chooseItem=(idx:number,id:string,target:"token"|"work")=>{
    const it=items.find(x=>x.id===id),setter=target==="token"?setTokenLines:setWorkLines;
    setter(v=>v.map((x,j)=>j===idx?{...x,item_id:id||null,item_description:it?[it.name,it.size,it.grade].filter(Boolean).join(" / "):"",uom:it?.unit||"kg",warehouse_id:target==="work"?(it?.warehouse_id||null):x.warehouse_id,godown_id:null}:x));
  };

  const openNew=()=>{setEditingId(null);setSelected(null);setInstructionId("");setToken(emptyToken());setTokenLines([emptyLine()]);setCreateOpen(true)};
  const openEdit=(g:GP)=>{
    if(!isPreFinal(g))return setError("Final Gate Pass ke baad Token edit nahi ho sakta.");
    setEditingId(g.id);setSelected(g);setToken({customer_id:g.customer_id||"",customer_name:g.customer_name||"",vehicle_no:g.vehicle_no||"",driver_name:g.driver_name||"",token_notes:g.token_notes||"",pass_date:g.pass_date});setTokenLines((lines[g.id]||[]).map(x=>({...x})));setCreateOpen(true);
  };

  const saveToken=async(e:React.FormEvent)=>{
    e.preventDefault();setError(null);
    const valid=tokenLines.filter(x=>x.item_id&&x.requested_qty>0);
    if(!token.customer_id)return setError("Customer select karein.");
    if(!valid.length)return setError("Kam az kam aik material aur quantity required hai.");
    if(!editingId){
      const {data,error}=await supabase.from("gate_passes").insert({pass_no:"AUTO",type:"loading",customer_id:token.customer_id,customer_name:token.customer_name,vehicle_no:token.vehicle_no||null,driver_name:token.driver_name||null,token_notes:token.token_notes||null,status:"issued",pass_date:token.pass_date,tare_weight:0,gross_weight:0,net_weight:0,order_book_header_id:null,sales_order_id:null}).select("id").single();
      if(error)return setError(error.message);
      const {error:le}=await supabase.from("gate_pass_lines").insert(valid.map(x=>({gate_pass_id:data.id,item_id:x.item_id,item_description:x.item_description,requested_qty:x.requested_qty,actual_qty:0,uom:x.uom,remarks:x.remarks})));
      if(le)return setError(le.message);
    }else{
      const gp=rows.find(r=>r.id===editingId);
      if(!gp||!isPreFinal(gp))return setError("Final Gate Pass ke baad Token edit nahi ho sakta.");
      const {error}=await supabase.from("gate_passes").update({customer_id:token.customer_id,customer_name:token.customer_name,vehicle_no:token.vehicle_no||null,driver_name:token.driver_name||null,token_notes:token.token_notes||null,pass_date:token.pass_date}).eq("id",editingId);
      if(error)return setError(error.message);
      const existing=lines[editingId]||[];
      const keptIds=new Set(valid.map(x=>x.id).filter(Boolean) as string[]);
      const loadedRemoval=existing.find(x=>x.id&&!keptIds.has(x.id)&&x.actual_qty>0);
      if(loadedRemoval)return setError("Loaded line ko Token se delete nahi kar sakte. Pehle Edit Loading se correction karein.");
      const deleteIds=existing.filter(x=>x.id&&!keptIds.has(x.id)&&x.actual_qty<=0).map(x=>x.id as string);
      if(deleteIds.length){const {error:de}=await supabase.from("gate_pass_lines").delete().in("id",deleteIds);if(de)return setError(de.message)}
      for(const x of valid){
        if(x.id){const {error:ue}=await supabase.from("gate_pass_lines").update({item_id:x.item_id,item_description:x.item_description,requested_qty:x.requested_qty,uom:x.uom,remarks:x.remarks}).eq("id",x.id);if(ue)return setError(ue.message)}
        else{const {error:ie}=await supabase.from("gate_pass_lines").insert({gate_pass_id:editingId,item_id:x.item_id,item_description:x.item_description,requested_qty:x.requested_qty,actual_qty:0,uom:x.uom,remarks:x.remarks});if(ie)return setError(ie.message)}
      }
    }
    setCreateOpen(false);await load();
  };

  const openKanta=(g:GP,stage:"tare"|"gross")=>{
    if(!isPreFinal(g))return setError("Final Gate Pass ke baad Kanta edit nahi ho sakta.");
    setSelected(g);setKantaStage(stage);setTare(String(g.tare_weight||""));setGross(String(g.gross_weight||""));setWeighRef(stage==="tare"?(g.tare_weighbridge_reference||""):(g.gross_weighbridge_reference||""));setKantaOpen(true);
  };
  const saveKanta=async(e:React.FormEvent)=>{
    e.preventDefault();if(!selected)return;setError(null);
    if(kantaStage==="tare"){
      if(+tare<=0)return setError("Valid empty/tare weight required hai.");
      const {error}=await supabase.from("gate_passes").update({tare_weight:+tare,tare_weighbridge_reference:weighRef||null,tare_weighed_at:new Date().toISOString(),status:selected.status==="issued"?"tare_weighed":selected.status}).eq("id",selected.id);
      if(error)return setError(error.message);
    }else{
      if(+tare<=0||+gross<=+tare)return setError("Valid tare aur loaded/gross weight required hai.");
      const {error}=await supabase.from("gate_passes").update({tare_weight:+tare,gross_weight:+gross,gross_weighbridge_reference:weighRef||null,weighbridge_reference:weighRef||null,gross_weighed_at:new Date().toISOString(),weighed_at:new Date().toISOString(),status:"weighed"}).eq("id",selected.id);
      if(error)return setError(error.message);
    }
    setKantaOpen(false);await load();
  };

  const openLoading=(g:GP)=>{
    if(!isPreFinal(g))return setError("Final Gate Pass ke baad Loading edit nahi ho sakti.");
    setSelected(g);setLoaderId(g.loaded_by_loader_id||"");setWorkLines((lines[g.id]||[]).map(x=>({...x})));setLoadingOpen(true);
  };
  const saveLoading=async(e:React.FormEvent)=>{
    e.preventDefault();if(!selected)return;setError(null);
    const loader=loaders.find(x=>x.id===loaderId);if(!loader)return setError("Loader select karein.");
    for(const x of workLines){
      if(!x.item_id||x.actual_qty<=0||!x.warehouse_id||!x.godown_id)return setError("Har line par Actual Qty, Warehouse aur Godown required hain.");
      if(x.id){const {error}=await supabase.from("gate_pass_lines").update({actual_qty:x.actual_qty,warehouse_id:x.warehouse_id,godown_id:x.godown_id,remarks:x.remarks}).eq("id",x.id);if(error)return setError(error.message)}
      else{const {error}=await supabase.from("gate_pass_lines").insert({gate_pass_id:selected.id,item_id:x.item_id,item_description:x.item_description,requested_qty:0,actual_qty:x.actual_qty,uom:x.uom,warehouse_id:x.warehouse_id,godown_id:x.godown_id,remarks:x.remarks||"Added during loading"});if(error)return setError(error.message)}
    }
    const nextStatus:Status=selected.status==="weighed"?"weighed":"loading";
    const {error}=await supabase.from("gate_passes").update({status:nextStatus,loaded_by_loader_id:loader.id,loaded_by_name:loaderLabel(loader),loading_completed_at:new Date().toISOString()}).eq("id",selected.id);
    if(error)return setError(error.message);
    setLoadingOpen(false);await load();
  };

  const finalize=async(g:GP)=>{const {error}=await supabase.from("gate_passes").update({status:"finalized"}).eq("id",g.id);if(error)setError(error.message);else await load()};

  const printDoc=(g:GP)=>{
    const lang=documentLanguage();
    const ls=lines[g.id]||[],isFinal=g.status==="finalized",hasLoading=["loading","weighed","finalized"].includes(g.status);
    const bodyRows=ls.map((x,i)=>`<tr><td>${i+1}</td><td dir="auto">${esc(lineDisplay(x))}</td><td>${esc(x.requested_qty)} ${esc(x.uom)}</td><td>${hasLoading?`${esc(x.actual_qty)} ${esc(x.uom)}`:"________________"}</td><td>${hasLoading?esc(x.warehouse?.name||"—"):"________________"}</td><td>${hasLoading?esc(x.godown?.name||"—"):"________________"}</td><td>${hasLoading?esc(x.remarks||""):"________________"}</td></tr>`).join("")+(!hasLoading?Array.from({length:3},(_,i)=>`<tr><td>${ls.length+i+1}</td><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`).join(""):"");
    const company=esc(activeCompany?.company_name||"NAVILO ERP"),unit=esc(activeBusinessUnit?.business_unit_name||"");
    const html=`<article class="print-document gp-doc"><header><img src="/navilo-logo.svg"/><div><h1>${company}</h1><b>${unit}</b><small>Run Your Business as One.</small></div><section><strong>${isFinal?lang.label("FINAL GATE PASS","حتمی گیٹ پاس"):lang.label("LOADING WORKSHEET","لوڈنگ ورک شیٹ")}</strong><span>${esc(g.pass_no)}</span></section></header><div class="meta"><div><b>${lang.label("Customer","کسٹمر")}</b><span>${esc(customerDisplay(g))}</span></div><div><b>${lang.label("Vehicle","گاڑی")}</b><span>${esc(g.vehicle_no||"—")}</span></div><div><b>${lang.label("Driver","ڈرائیور")}</b><span>${esc(g.driver_name||"—")}</span></div><div><b>${lang.label("Date","تاریخ")}</b><span>${esc(g.pass_date)}</span></div></div>${g.token_notes?`<div class="notes"><b>${lang.label("Token Instructions","ہدایات")}:</b> ${esc(g.token_notes)}</div>`:""}<h2>${lang.label("Material Loading Record","مال لوڈنگ ریکارڈ")}</h2><table><thead><tr><th>#</th><th>${lang.label("Requested Material","مطلوبہ مال")}</th><th>Requested Qty</th><th>${lang.label("Actual Loaded","اصل مقدار")}</th><th>Warehouse</th><th>Godown</th><th>Remarks</th></tr></thead><tbody>${bodyRows}</tbody></table><h2>${lang.label("Weighbridge Record","کانٹا ریکارڈ")}</h2><div class="weights"><div><b>${lang.label("1st Kanta — Empty/Tare","پہلا کانٹا — خالی وزن")}</b><strong>${g.tare_weight>0?`${esc(g.tare_weight)} kg`:"________________ kg"}</strong><small>Ref: ${esc(g.tare_weighbridge_reference||"____________")}</small></div><div><b>${lang.label("2nd Kanta — Loaded/Gross","دوسرا کانٹا — بھرا وزن")}</b><strong>${g.gross_weight>0?`${esc(g.gross_weight)} kg`:"________________ kg"}</strong><small>Ref: ${esc(g.gross_weighbridge_reference||"____________")}</small></div><div><b>${lang.label("Net Material","خالص مال")}</b><strong>${g.net_weight>0?`${esc(g.net_weight)} kg`:"________________ kg"}</strong></div></div><h2>${lang.label("Loading Staff","لوڈنگ عملہ")}</h2><div class="sign"><span><b>Loader:</b> ${hasLoading?esc(g.loaded_by_name||"—"):"________________________"}</span><span><b>Signature:</b> ________________________</span><span><b>Office Received:</b> ________________________</span></div><footer><span>${lang.label("Prepared By","تیار کردہ")}</span><b>NAVILO</b><span>${lang.label("Authorized By","مجاز دستخط")}</span></footer></article><style>.gp-doc{font-family:Arial,"Noto Nastaliq Urdu",sans-serif;color:#0f172a;font-size:10px}.gp-doc header{display:grid;grid-template-columns:90px 1fr 180px;align-items:center;border-bottom:2px solid #2563eb;padding-bottom:10px}.gp-doc header img{width:54px}.gp-doc header h1{font-size:20px;margin:0}.gp-doc header small{display:block;color:#64748b;margin-top:3px}.gp-doc header section{background:#eff6ff;border-radius:10px;padding:10px;text-align:center}.gp-doc header section strong,.gp-doc header section span{display:block}.meta{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:6px;margin:12px 0}.meta div,.notes{border:1px solid #cbd5e1;border-radius:6px;padding:7px}.meta b,.meta span{display:block}.meta b{font-size:8px;color:#64748b;text-transform:uppercase}.gp-doc h2{font-size:11px;margin:12px 0 5px;background:#f1f5f9;padding:5px;border-left:3px solid #2563eb}.gp-doc table{width:100%;border-collapse:collapse;table-layout:fixed}.gp-doc th,.gp-doc td{border:1px solid #94a3b8;padding:5px;vertical-align:top;height:34px}.gp-doc th{background:#0f4c81;color:white;font-size:8px}.gp-doc th:first-child{width:4%}.weights{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}.weights div{border:1px solid #94a3b8;border-radius:6px;padding:9px;min-height:62px}.weights strong,.weights small{display:block;margin-top:6px}.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;border:1px solid #cbd5e1;padding:12px}.gp-doc footer{display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;margin-top:28px;padding-top:10px;border-top:1px solid #2563eb}.gp-doc footer b{color:#2563eb;font-size:14px}</style>`;
    window.dispatchEvent(new CustomEvent("navilo:print-preview",{detail:{html,title:`${g.pass_no} ${isFinal?"Final Gate Pass":"Loading Worksheet"}`,orientation:"portrait"}}));
  };

  return <div className="space-y-4">
    <PageHeader title="Gate Pass / Loading / Kanta" subtitle="Token → 1st Kanta (Tare) → Loading → 2nd Kanta (Gross) → Final Gate Pass" action={<button className="btn btn-primary" onClick={openNew}>+ New Loading Token</button>}/>
    {error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">{(["issued","tare_weighed","loading","weighed","finalized"] as Status[]).map(s=><div key={s} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{labels[s]}</div><div className="text-2xl font-bold">{rows.filter(r=>r.status===s).length}</div></div>)}</div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Token / GP</th><th>Customer</th><th>Vehicle</th><th>Material</th><th>Status</th><th>Action</th></tr></thead><tbody>{busy?<tr><td colSpan={6} className="p-5">Loading…</td></tr>:rows.map(g=><tr key={g.id} className="border-t"><td className="p-3 font-semibold">{g.pass_no}</td><td>{customerDisplay(g)}</td><td>{g.vehicle_no||"—"}</td><td>{(lines[g.id]||[]).map(x=><div key={x.id}>{lineDisplay(x)}</div>)}</td><td>{labels[g.status]}</td><td><div className="flex flex-wrap gap-1"><button className="btn btn-secondary" data-direct-print onClick={()=>printDoc(g)}>{g.status==="finalized"?"Print Final GP":"Print Loading Worksheet"}</button>{isPreFinal(g)&&<button className="btn btn-secondary" onClick={()=>openEdit(g)}>Edit Token</button>}{isPreFinal(g)&&<button className="btn btn-secondary" onClick={()=>openKanta(g,"tare")}>{g.tare_weight>0?"Edit 1st Kanta / Tare":"1st Kanta / Tare"}</button>}{isPreFinal(g)&&<button className="btn btn-primary" onClick={()=>openLoading(g)}>{["loading","weighed"].includes(g.status)?"Edit Loading":"Loading"}</button>}{["loading","weighed"].includes(g.status)&&<button className="btn btn-primary" onClick={()=>openKanta(g,"gross")}>{g.gross_weight>0?"Edit 2nd Kanta / Gross":"2nd Kanta / Gross"}</button>}{g.status==="weighed"&&<button className="btn btn-primary" onClick={()=>void finalize(g)}>Generate Final GP</button>}</div></td></tr>)}</tbody></table></div>

    <Modal open={createOpen} onClose={()=>setCreateOpen(false)} title={editingId?`Edit Token — ${selected?.pass_no}`:"New Loading Token"} panelClassName="!max-w-6xl !w-[96vw]"><form onSubmit={saveToken} className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><div><label className="label">Token / GP No.</label><input className="input bg-slate-100" readOnly value={editingId?selected?.pass_no||"":`${nextNo} (Auto)`}/></div><div><label className="label">Customer / Party</label><SearchableSelect className="input" value={token.customer_id} onChange={e=>{const c=customers.find(x=>x.id===e.target.value);setToken(t=>({...t,customer_id:e.target.value,customer_name:c?.name||""}))}}><option value="">Select Customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}{c.name_urdu?` / ${c.name_urdu}`:""}</option>)}</SearchableSelect></div><div><label className="label">Vehicle No.</label><input className="input" value={token.vehicle_no} onChange={e=>setToken({...token,vehicle_no:e.target.value})}/></div><div><label className="label">Date</label><input type="date" className="input" value={token.pass_date} onChange={e=>setToken({...token,pass_date:e.target.value})}/></div><div><label className="label">Driver</label><input className="input" value={token.driver_name} onChange={e=>setToken({...token,driver_name:e.target.value})}/></div><div className="md:col-span-3"><div className="flex justify-between"><label className="label">Token Instructions / Notes — English / اردو</label><button type="button" className="text-xs font-semibold text-blue-600" onClick={()=>setInstructionOpen(true)}>+ Add New</button></div><SearchableSelect className="input" value={instructionId} onChange={e=>{setInstructionId(e.target.value);const x=instructions.find(a=>a.id===e.target.value);if(x)setToken(t=>({...t,token_notes:[x.name_en,x.name_ur].filter(Boolean).join(" / ")}))}}><option value="">Search / Select Instruction</option>{instructions.map(x=><option key={x.id} value={x.id}>{x.name_en}{x.name_ur?` / ${x.name_ur}`:""}</option>)}</SearchableSelect><textarea className="input mt-2 min-h-20" dir="auto" value={token.token_notes} onChange={e=>setToken({...token,token_notes:e.target.value})}/></div></div>{tokenLines.map((x,i)=><div key={x.id||i} className="grid grid-cols-12 gap-2"><div className="col-span-5"><SearchableSelect className="input" value={x.item_id||""} onChange={e=>chooseItem(i,e.target.value,"token")}><option value="">Select Item</option>{items.map(it=><option key={it.id} value={it.id}>{[it.sku,it.name,it.name_urdu,it.size,it.grade].filter(Boolean).join(" · ")}</option>)}</SearchableSelect></div><input className="input col-span-2" type="number" placeholder="Qty" value={x.requested_qty||""} onChange={e=>setTokenLines(v=>v.map((a,j)=>j===i?{...a,requested_qty:+e.target.value}:a))}/><div className="col-span-2"><SearchableSelect className="input" value={x.uom} onChange={e=>setTokenLines(v=>v.map((a,j)=>j===i?{...a,uom:e.target.value}:a))}>{uoms.map(u=><option key={u.id} value={u.symbol}>{u.symbol} · {u.name}</option>)}</SearchableSelect></div><input className="input col-span-3" placeholder="Remarks" value={x.remarks||""} onChange={e=>setTokenLines(v=>v.map((a,j)=>j===i?{...a,remarks:e.target.value}:a))}/></div>)}<div className="flex justify-between"><button type="button" className="btn btn-secondary" onClick={()=>setTokenLines(v=>[...v,emptyLine()])}>+ Add Material</button><button className="btn btn-primary">{editingId?"Save Token Changes":"Issue & Save Token"}</button></div></form></Modal>

    <Modal open={loadingOpen} onClose={()=>setLoadingOpen(false)} title={`${selected&&["loading","weighed"].includes(selected.status)?"Edit Loading":"Loading"} — ${selected?.pass_no||""}`} panelClassName="!max-w-7xl !w-[97vw]"><form onSubmit={saveLoading} className="space-y-4"><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>Token Details:</b> {selected&&customerDisplay(selected)} · Vehicle {selected?.vehicle_no||"—"} {selected?.tare_weight?`· 1st Kanta Tare ${selected.tare_weight} kg`:"· 1st Kanta not recorded"}</div><div className="flex items-end justify-between gap-3"><div className="min-w-[420px]"><div className="flex justify-between"><label className="label">Loaded By / Loader</label><div className="flex gap-3"><button type="button" className="text-xs font-semibold text-blue-600" onClick={()=>{setEditingLoaderId(null);setNewLoader({en:"",ur:"",phone:""});setLoaderOpen(true)}}>+ Add New Loader</button><button type="button" className="text-xs font-semibold text-amber-600 disabled:text-slate-400" disabled={!loaderId} onClick={()=>{const x=loaders.find(a=>a.id===loaderId);if(x){setEditingLoaderId(x.id);setNewLoader({en:x.name_en,ur:x.name_ur||"",phone:x.phone||""});setLoaderOpen(true)}}}>Edit Loader</button></div></div><SearchableSelect className="input" value={loaderId} onChange={e=>setLoaderId(e.target.value)}><option value="">Select Loader</option>{loaders.map(x=><option key={x.id} value={x.id}>{loaderLabel(x)}{x.phone?` · ${x.phone}`:""}</option>)}</SearchableSelect></div><button type="button" className="btn btn-secondary" onClick={()=>setWorkLines(v=>[...v,emptyLine()])}>+ Add Loaded Material</button></div>{workLines.map((x,i)=><div key={x.id||i} className="grid grid-cols-12 gap-2">{x.id?<div className="col-span-3 p-2">{lineDisplay(x)}<div className="text-xs text-slate-400">Token Qty: {x.requested_qty} {x.uom}</div></div>:<div className="col-span-3"><SearchableSelect className="input" value={x.item_id||""} onChange={e=>chooseItem(i,e.target.value,"work")}><option value="">Select Material</option>{items.map(it=><option key={it.id} value={it.id}>{it.name}{it.name_urdu?` / ${it.name_urdu}`:""}</option>)}</SearchableSelect></div>}<input className="input col-span-2" type="number" placeholder="Actual Qty" value={x.actual_qty||""} onChange={e=>setWorkLines(v=>v.map((a,j)=>j===i?{...a,actual_qty:+e.target.value}:a))}/><div className="col-span-2"><SearchableSelect className="input" value={x.warehouse_id||""} onChange={e=>setWorkLines(v=>v.map((a,j)=>j===i?{...a,warehouse_id:e.target.value||null,godown_id:null}:a))}><option value="">Warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}{w.name_urdu?` / ${w.name_urdu}`:""}</option>)}</SearchableSelect></div><div className="col-span-2"><SearchableSelect className="input" value={x.godown_id||""} onChange={e=>setWorkLines(v=>v.map((a,j)=>j===i?{...a,godown_id:e.target.value||null}:a))}><option value="">Godown</option>{godowns.filter(g=>g.warehouse_id===x.warehouse_id).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</SearchableSelect></div><input className="input col-span-3" placeholder="Loading Remarks / Method" value={x.remarks||""} onChange={e=>setWorkLines(v=>v.map((a,j)=>j===i?{...a,remarks:e.target.value}:a))}/></div>)}<div className="flex justify-end"><button className="btn btn-primary">{selected?.status==="weighed"?"Save Loading Correction":"Save Loading & Send to 2nd Kanta"}</button></div></form></Modal>

    <Modal open={kantaOpen} onClose={()=>setKantaOpen(false)} title={`${kantaStage==="tare"?"1st Kanta — Empty/Tare":"2nd Kanta — Loaded/Gross"} — ${selected?.pass_no||""}`}><form onSubmit={saveKanta} className="space-y-3"><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{selected&&customerDisplay(selected)}</b> · Vehicle {selected?.vehicle_no||"—"}{kantaStage==="gross"&&<div className="mt-2">Loaded By: {selected?.loaded_by_name||"—"}<br/>{selected&&(lines[selected.id]||[]).map(x=><span key={x.id} className="mr-3">{lineDisplay(x)}: <b>{x.actual_qty} {x.uom}</b></span>)}</div>}</div>{kantaStage==="tare"?<input className="input" type="number" placeholder="Empty / Tare Weight kg" value={tare} onChange={e=>setTare(e.target.value)}/>:<div className="grid grid-cols-3 gap-3"><input className="input bg-slate-100" value={`${tare||0} kg Tare`} readOnly/><input className="input" type="number" placeholder="Loaded / Gross kg" value={gross} onChange={e=>setGross(e.target.value)}/><input className="input bg-slate-100" value={`${net} kg Net`} readOnly/></div>}<input className="input" placeholder={`${kantaStage==="tare"?"1st":"2nd"} Kanta Slip / Reference`} value={weighRef} onChange={e=>setWeighRef(e.target.value)}/><div className="flex justify-end"><button className="btn btn-primary">Save {kantaStage==="tare"?"1st Kanta":"2nd Kanta"}</button></div></form></Modal>

    <Modal open={instructionOpen} onClose={()=>setInstructionOpen(false)} title="Add Loading Instruction / لوڈنگ ہدایت"><div className="space-y-3"><input className="input" placeholder="English" value={newInstruction.en} onChange={e=>setNewInstruction({...newInstruction,en:e.target.value})}/><div className="flex gap-2"><input className="input text-right" dir="rtl" placeholder="اردو" value={newInstruction.ur} onChange={e=>setNewInstruction({...newInstruction,ur:e.target.value})}/><button className="btn btn-secondary" type="button" onClick={()=>setNewInstruction(v=>({...v,ur:toUrduName(v.en)}))}>Auto Urdu</button></div><div className="flex justify-end"><button className="btn btn-primary" type="button" onClick={async()=>{if(!newInstruction.en.trim())return;const {data,error}=await supabase.from("gate_pass_loading_instructions").insert({instruction:newInstruction.en.trim(),name_en:newInstruction.en.trim(),name_ur:newInstruction.ur.trim()||toUrduName(newInstruction.en)||null}).select("id,name_en,name_ur").single();if(error)return setError(error.message);const x=data as Instruction;setInstructions(v=>[...v,x]);setInstructionId(x.id);setToken(t=>({...t,token_notes:[x.name_en,x.name_ur].filter(Boolean).join(" / ")}));setInstructionOpen(false)}}>Save & Use</button></div></div></Modal>

    <Modal open={loaderOpen} onClose={()=>setLoaderOpen(false)} title={editingLoaderId?"Edit Loader / لوڈر میں ترمیم":"Add Loader / نیا لوڈر"}><div className="space-y-3"><input className="input" placeholder="English Name" value={newLoader.en} onChange={e=>setNewLoader(v=>({...v,en:e.target.value}))}/><div className="flex gap-2"><input className="input text-right" dir="rtl" placeholder="Urdu Name" value={newLoader.ur} onChange={e=>setNewLoader(v=>({...v,ur:e.target.value}))}/><button type="button" className="btn btn-secondary" onClick={()=>setNewLoader(v=>({...v,ur:toUrduName(v.en)}))}>Auto Urdu</button></div><input className="input" placeholder="Phone" value={newLoader.phone} onChange={e=>setNewLoader(v=>({...v,phone:e.target.value}))}/><div className="flex justify-end"><button type="button" className="btn btn-primary" onClick={async()=>{if(!newLoader.en.trim())return;const payload={name_en:newLoader.en.trim(),name_ur:newLoader.ur.trim()||toUrduName(newLoader.en)||null,phone:newLoader.phone.trim()||null};const q=editingLoaderId?supabase.from("gate_pass_loaders").update(payload).eq("id",editingLoaderId):supabase.from("gate_pass_loaders").insert(payload);const {data,error}=await q.select("id,name_en,name_ur,phone").single();if(error)return setError(error.message);const x=data as Loader;setLoaders(v=>editingLoaderId?v.map(a=>a.id===x.id?x:a):[...v,x]);setLoaderId(x.id);setLoaderOpen(false)}}>{editingLoaderId?"Update & Select Loader":"Save & Select Loader"}</button></div></div></Modal>
  </div>;
}
