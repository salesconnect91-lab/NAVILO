import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

type Props = {
  companyId: string;
  companyName: string;
  companyCode: string;
  onDeleted: () => Promise<void> | void;
};

export default function CompanyDeleteControl({ companyId, companyName, companyCode, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expected = `DELETE ${companyCode}`;

  const remove = async () => {
    if (confirmation !== expected || !acknowledge) return;
    if (!window.confirm(`Permanently delete unused company ${companyName}? This works only when no protected financial or operational evidence exists and cannot be undone.`)) return;

    setBusy(true);
    setError("");
    try {
      await invokeEdgeFunction("platform-admin", {
        action: "delete_company",
        company_id: companyId,
        confirmation,
        acknowledge: true,
      });
      setOpen(false);
      setConfirmation("");
      setAcknowledge(false);
      await onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Company deletion failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <button type="button" className="btn-secondary border-red-200 text-red-700 hover:bg-red-50" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4"/>Delete</button>;
  }

  return <div className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 p-3">
    <div className="flex items-start gap-2 text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><div><div className="text-sm font-semibold">Permanently delete {companyName}</div><div className="mt-1 text-xs">Only an unused company can be permanently deleted. Financial or operational evidence blocks deletion; use Suspend/Close instead. Platform Owner login is not deleted.</div></div></div>
    <div className="mt-3 text-xs text-red-700">Type <strong>{expected}</strong> to confirm:</div>
    <input className="input mt-1 w-full" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={expected}/>
    <label className="mt-2 flex items-start gap-2 text-xs text-red-800"><input type="checkbox" className="mt-0.5" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)}/><span>I understand this permanently deletes only an unused company and cannot be undone.</span></label>
    {error && <div className="mt-2 text-xs font-medium text-red-700">{error}</div>}
    <div className="mt-3 flex gap-2">
      <button type="button" className="btn-primary bg-red-700 hover:bg-red-800" disabled={busy || confirmation !== expected || !acknowledge} onClick={() => void remove()}>{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}Delete Permanently</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setOpen(false); setConfirmation(""); setAcknowledge(false); setError(""); }}>Cancel</button>
    </div>
  </div>;
}
