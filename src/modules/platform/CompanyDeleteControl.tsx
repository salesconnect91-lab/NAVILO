import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

type Preview={total_rows:number;counts:Record<string,number>;preserved:string[]};
type DeleteResult={success?:boolean;deleted_company_id?:string};
type ResetResult={success?:boolean;deleted_rows?:number};
type Props={companyId:string;companyName:string;companyCode:string;isTestCompany:boolean;onDeleted:()=>Promise<void>|void};

export default function CompanyDeleteControl({companyId,companyName,companyCode,isTestCompany,onDeleted}:Props){
 const [mode,setMode]=useState<"delete"|"purge"|null>(null),[confirmation,setConfirmation]=useState(""),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[preview,setPreview]=useState<Preview|null>(null);
 const expected=mode==="purge"?`PURGE ${companyCode}`:`DELETE ${companyCode}`;
 const reset=()=>{setMode(null);setConfirmation("");setAck(false);setError("");setPreview(null)};
 const openPurge=async()=>{setMode("purge");setBusy(true);setError("");setPreview(null);try{const p=await invokeEdgeFunction<Preview>("platform-admin",{action:"purge_test_company_preview",company_id:companyId});setPreview(p)}catch(e){setError(e instanceof Error?e.message:"Could not preview test company purge.")}finally{setBusy(false)}};
 const run=async()=>{
  if(confirmation!==expected||!ack)return;
  const purge=mode==="purge";
  if(!window.confirm(purge?`Reset ALL transactional/test data first, verify it is empty, then permanently delete ${companyName}? This cannot be undone.`:`Permanently delete unused company ${companyName}? This cannot be undone.`))return;
  setBusy(true);setError("");
  try{
   if(purge){
    const resetResult=await invokeEdgeFunction<ResetResult>("platform-admin",{action:"reset_company_transactions",company_id:companyId,confirmation:`RESET ${companyCode}`,acknowledge:true});
    if(resetResult?.success===false)throw new Error("Company reset was not confirmed by the backend. Delete was stopped.");
    const verification=await invokeEdgeFunction<Preview>("platform-admin",{action:"reset_company_preview",company_id:companyId});
    if(!verification||verification.total_rows!==0)throw new Error(`Reset verification failed: ${Number(verification?.total_rows??0).toLocaleString()} resettable row(s) remain. Company was NOT deleted.`);
    const result=await invokeEdgeFunction<DeleteResult>("platform-admin",{action:"purge_test_company",company_id:companyId,confirmation:`PURGE ${companyCode}`,acknowledge:true});
    if(result?.success!==true||result.deleted_company_id!==companyId)throw new Error("Reset completed, but backend did not confirm deletion of the selected company.");
   }else{
    const result=await invokeEdgeFunction<DeleteResult>("platform-admin",{action:"delete_company",company_id:companyId,confirmation,acknowledge:true});
    if(result?.success===false)throw new Error("Company deletion was not confirmed by the backend.");
   }
   reset();await onDeleted();
  }catch(e){setError(e instanceof Error?e.message:"Company deletion failed.");}
  finally{setBusy(false)}
 };
 if(!mode)return <div className="flex flex-wrap gap-2">{isTestCompany?<button type="button" className="btn-secondary border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100" onClick={()=>void openPurge()}><AlertTriangle className="h-4 w-4"/>Reset & Delete Test Company</button>:<button type="button" className="btn-secondary border-red-200 text-red-700 hover:bg-red-50" onClick={()=>setMode("delete")}><Trash2 className="h-4 w-4"/>Delete Empty Company</button>}</div>;
 return <div className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 p-3">
  <div className="flex items-start gap-2 text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><div><div className="text-sm font-semibold">{mode==="purge"?"Reset then permanently delete test company":"Permanently delete empty company"}: {companyName}</div><div className="mt-1 text-xs">{mode==="purge"?"NAVILO will first reset transactional/test data, verify that no resettable rows remain, and only then purge remaining company-owned setup and delete the company. If reset verification fails, deletion is stopped. Global login/auth users and platform audit history remain protected.":"Only an unused company can be deleted; protected evidence blocks deletion."}</div></div></div>
  {mode==="purge"&&<div className="mt-3 rounded border border-rose-200 bg-white p-2 text-xs">{busy&&!preview?"Loading delete preview…":preview?<><b>{preview.total_rows.toLocaleString()} company-owned row(s)</b> detected across {Object.keys(preview.counts).length} table(s).<div className="mt-1 max-h-28 overflow-auto">{Object.entries(preview.counts).filter(([,n])=>n>0).map(([k,n])=><div key={k} className="flex justify-between gap-3"><span>{k.replaceAll("_"," ")}</span><b>{n.toLocaleString()}</b></div>)}</div></>:error?"Preview failed. Reset & Delete is disabled.":"Preview required."}</div>}
  <div className="mt-3 text-xs text-red-700">Type <strong>{expected}</strong> exactly:</div><input className="input mt-1 w-full" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={expected}/>
  <label className="mt-2 flex items-start gap-2 text-xs text-red-800"><input type="checkbox" className="mt-0.5" checked={ack} onChange={e=>setAck(e.target.checked)}/><span>I understand this action is permanent and cannot be undone.</span></label>
  {error&&<div role="alert" className="mt-2 text-xs font-medium text-red-700">{error}</div>}
  <div className="mt-3 flex gap-2"><button type="button" className="btn-primary bg-red-700 hover:bg-red-800" disabled={busy||confirmation!==expected||!ack||(mode==="purge"&&!preview)} onClick={()=>void run()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Trash2 className="h-4 w-4"/>}{mode==="purge"?"Reset, Verify & Delete":"Delete Permanently"}</button><button type="button" className="btn-secondary" disabled={busy} onClick={reset}>Cancel</button></div>
 </div>;
}
