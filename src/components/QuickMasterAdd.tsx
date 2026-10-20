import {lazy,Suspense,useState} from "react";
import {useAuth} from "@/auth/AuthContext";
import type {QuickAddKind} from "@/modules/transport/transportTripEntry";

const TransportQuickAdd=lazy(()=>import("@/modules/transport/TransportQuickAdd"));
const TransportFoundationMaster=lazy(()=>import("@/modules/master-data/TransportFoundationMaster"));

export type QuickMasterKind=QuickAddKind|"vehicleExpenseType"|"account"|"item"|"godown"|"employee";
export type QuickMasterRecord={id:string;name:string;truck_type_id?:string};
const pages:Partial<Record<QuickMasterKind,string>>={
 account:"/accounting/accounts",item:"/master-data",godown:"/master-data/warehouses",employee:"/master-data/employees"
};
const labels:Record<QuickMasterKind,string>={
 customer:"Customer",supplier:"Supplier",vehicle:"Vehicle",driver:"Driver",
 truckType:"Truck Type",locationFrom:"Location",locationTo:"Location",
 vehicleExpenseType:"Expense Type",account:"Account",item:"Item",godown:"Godown",employee:"Employee"
};

/** + New Master next to selectors. Canonical editors stay responsible for
 * permissions/validation; no direct insert or duplicate create logic.
 * Master pages open separately so an unfinished invoice/counter form is never lost.
 */
export default function QuickMasterAdd({
 kind,onCreated,onRefresh,disabled=false,truckTypeId="",supplierId="",initialName="",compact=false
}:{
 kind:QuickMasterKind;
 onCreated?:(row:QuickMasterRecord)=>void|Promise<void>;
 onRefresh?:()=>void|Promise<void>;
 disabled?:boolean;truckTypeId?:string;supplierId?:string;initialName?:string;compact?:boolean;
}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const scope=`${activeCompany?.company_id??""}:${activeBusinessUnit?.business_unit_id??""}`;
 const [open,setOpen]=useState(false),[masterTab,setMasterTab]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [dialogScope,setDialogScope]=useState(scope);
 const route=pages[kind],label=labels[kind];
 const showDialog=open&&dialogScope===scope;
 const openMaster=()=>{
  if(disabled)return;
  setError("");
  if(route){
   // Browsers deliberately return null when window.open uses noopener.
   // Open synchronously on the user gesture, then detach the opener.
   const windowRef=window.open(route,"_blank");
   if(!windowRef){setError("Allow opening a new tab for "+label+" Master.");return}
   windowRef.opener=null;
   setMasterTab(true);
  }else{setDialogScope(scope);setOpen(true)}
 };
 const handleCreated=async(row:QuickMasterRecord)=>{
  if(dialogScope!==scope)throw new Error("Active company changed. Refresh the master before selecting.");
  await onCreated?.(row);
 };
 const refresh=async()=>{
  if(!onRefresh)return;
  setBusy(true);setError("");
  try{await onRefresh();setMasterTab(false)}
  catch(e){setError(e instanceof Error?e.message:"Unable to refresh "+label+" Master.")}
  finally{setBusy(false)}
 };
 return <span className="inline-flex max-w-full flex-wrap items-center gap-1" data-quick-master-kind={kind}>
   <button type="button" className={compact?"btn-secondary !min-h-7 px-2 py-0.5 text-[11px]":"btn-secondary px-2 py-1 text-xs"}
    disabled={disabled} title={`Create new ${label} Master`}
    aria-label={`Add new ${label}`} onClick={openMaster}>+ {compact?"":`New ${label}`}</button>
   {route&&masterTab&&<button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={()=>void refresh()}
    disabled={busy} title={`Refresh ${label} options after saving the Master in the other tab`}
    aria-label={`Refresh ${label} options`}>{busy?"Refreshing…":"↻ Refresh"}</button>}
   {error&&<span role="alert" className="max-w-56 text-xs text-red-700">{error}</span>}
   {showDialog&&<Suspense fallback={<span role="status" className="text-xs">Opening {label} editor…</span>}>
     {kind==="vehicleExpenseType"
      ?<TransportFoundationMaster kind="vehicle_expense_types" quickCreate={{onCreated:handleCreated,onClose:()=>setOpen(false),initialName}}/>
      :<TransportQuickAdd kind={kind as QuickAddKind} truckTypeId={truckTypeId} supplierId={supplierId}
         truckTypes={[]} suppliers={[]} initialName={initialName} onCreated={handleCreated} onClose={()=>setOpen(false)}/>}
   </Suspense>}
 </span>;
}
