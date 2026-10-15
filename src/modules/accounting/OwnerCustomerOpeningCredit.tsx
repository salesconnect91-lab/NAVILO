import { useMemo, useState } from "react";
import SearchableSelect from "@/components/SearchableSelect";
import { supabase } from "@/lib/supabase";

type Account = {id:string; code:string; name:string; type:string; is_group?:boolean; is_active?:boolean; is_system_account?:boolean};
type Preview = {
  eligible:boolean; old_account:string; customer:string; opening_credit:number;
  ar_account:string; original_opening_journal:string; note:string;
};

export default function OwnerCustomerOpeningCredit({
  accounts,onCompleted
}: {accounts:Account[];onCompleted:()=>Promise<void>}) {
  const [accountId,setAccountId]=useState("");
  const [customerName,setCustomerName]=useState("");
  const [reason,setReason]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [busy,setBusy]=useState(false);
  const sources=useMemo(()=>accounts.filter(a=>a.type==="asset"&&a.is_active!==false&&!a.is_group&&!a.is_system_account),[accounts]);
  function changeSource(value:string){
    setAccountId(value);
    setCustomerName(sources.find(s=>s.id===value)?.name??"");
    setPreview(null);setError("");setSuccess("");
  }
  function invalidate(){setPreview(null);setError("");setSuccess("");}
  async function submit(previewOnly:boolean){
    if(!accountId||customerName.trim().length<2){
      setError("Select the wrong opening account and enter the new Customer Master name.");return;
    }
    if(!previewOnly&&(!preview||reason.trim().length<10)){
      setError("Preview first, then provide a reason of at least 10 characters.");return;
    }
    if(!previewOnly&&!window.confirm(
      "Confirm Software Owner correction?\n\nA customer will be created, the wrong ledger credited opening will be cleared by a compensating journal, and the old account will be deactivated. The original posted opening stays immutable. The credit will auto-apply to eligible new Sales Invoices."
    ))return;
    setBusy(true);setError("");setSuccess("");
    try{
      const {data,error:rpcError}=await supabase.rpc("owner_correct_customer_opening_credit",{
        p_account_id:accountId,p_customer_name:customerName.trim(),
        p_reason:reason.trim(),p_preview:previewOnly
      });
      if(rpcError)throw new Error(rpcError.message);
      if(previewOnly){
        if(!data?.eligible)throw new Error("This account is not eligible for the controlled credit correction.");
        setPreview(data as Preview);
      }else{
        if(!data?.success)throw new Error("The database did not confirm the correction.");
        setPreview(null);
        setSuccess(
          "Confirmed: Customer Master created, posted credit linked, wrong account deactivated, original opening preserved. Future eligible Sales Invoices will use available credit automatically."
        );
        await onCompleted();
      }
    }catch(e){
      setPreview(null);setError(e instanceof Error?e.message:"Correction did not complete.");
    }finally{setBusy(false);}
  }
  return <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-3">
    <p className="text-xs text-slate-700">
      For a <strong>Credit Opening Balance</strong> belonging to a customer, e.g. Cash Customer.
      Creates the Customer Master record linked to mapped Accounts Receivable (no new A/R control GL).
      Posts a compensating journal instead of deleting any posted opening entry.
    </p>
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">Wrong Opening Credit Account
        <SearchableSelect
          className="input mt-1 w-full"
          preserveLabel value={accountId}
          searchPlaceholder="Search account name or code..."
          aria-label="Wrong Opening Credit Account"
          onChange={e=>changeSource(e.target.value)}
        >
          <option value="">Select wrong account</option>
          {sources.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </SearchableSelect>
      </label>
      <label className="text-xs font-semibold text-slate-700">Create Customer Master · Name
        <input className="input mt-1 w-full" value={customerName}
          onChange={e=>{setCustomerName(e.target.value);invalidate();}}
          maxLength={160} placeholder="Cash Customer"/>
      </label>
    </div>
    <label className="block text-xs font-semibold text-slate-700">Owner Correction Reason (minimum 10 characters)
      <textarea className="input mt-1 w-full" rows={2} value={reason}
        maxLength={500} onChange={e=>{setReason(e.target.value);invalidate();}}
        placeholder="Credit opening belongs to customer, mistakenly created as an Asset ledger."/>
    </label>
    <p className="text-xs text-amber-900">
      Customer opening credit is automatically applied only against later posted Sales Invoices
      for the same customer, company, branch and base currency. No cash receipt or second
      opening balance is generated. Existing posted records are never edited.
    </p>
    {preview&&<div className="rounded border border-blue-300 bg-white p-3 text-xs text-slate-800">
      <strong>Eligibility verified</strong>
      <div className="mt-1">Wrong account: {preview.old_account}</div>
      <div>Customer Master: {preview.customer}</div>
      <div>Customer A/R control: {preview.ar_account}</div>
      <div>Opening Credit: <strong>{Number(preview.opening_credit).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
      <div>Original opening journal: {preview.original_opening_journal}</div>
      <div className="mt-1">On confirmation: wrong account becomes inactive; original posting stays untouched.</div>
    </div>}
    {error&&<p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">{error}</p>}
    {success&&<p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800" role="status">{success}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={()=>void submit(true)}
        className="rounded bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy?"Checking…":"Preview Credit Correction"}</button>
      <button type="button" disabled={busy||!preview} onClick={()=>void submit(false)}
        className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirm Owner Credit Correction</button>
    </div>
  </div>;
}
