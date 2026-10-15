import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type AccountItem = {
  id: string;
  code: string;
  name: string;
  type: string;
  parent_id?: string | null;
  is_group?: boolean;
  is_active?: boolean;
  is_system_account?: boolean;
};

type Preview = {
  eligible: boolean;
  old_name: string;
  old_code: string;
  new_name: string;
  new_code: string;
  new_parent: string;
  opening_debit: number;
  opening_credit: number;
  net_debit: number;
  original_opening_journal: string;
};

export default function OwnerOpeningAccountCorrection({
  accounts,
  onCompleted,
}: {
  accounts: AccountItem[];
  onCompleted: () => Promise<void>;
}) {
  const [isOwner, setIsOwner] = useState(false);
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [parentId, setParentId] = useState("");
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    let live = true;
    void supabase.rpc("owner_posted_control_access").then(({ data, error: rpcError }) => {
      if (live) setIsOwner(!rpcError && data === true);
    });
    return () => { live = false; };
  }, []);

  const sourceAccounts = useMemo(
    () => accounts.filter((a) => a.is_active !== false && !a.is_group && !a.is_system_account),
    [accounts]
  );
  const assetGroups = useMemo(
    () => accounts.filter((a) => a.is_active !== false && a.is_group && a.type === "asset"),
    [accounts]
  );

  if (!isOwner) return null;

  function resetPreview() {
    setPreview(null);
    setError("");
    setResult("");
  }

  function chooseSource(id: string) {
    setAccountId(id);
    const old = accounts.find((a) => a.id === id);
    setNewName(old?.name ?? "");
    setNewCode(old?.code ?? "");
    resetPreview();
  }

  async function run(previewOnly: boolean) {
    if (!accountId || !parentId || !newName.trim() || !newCode.trim()) {
      setError("Select the original account, Asset parent group, replacement name and code.");
      return;
    }
    if (!previewOnly && (!preview || reason.trim().length < 10)) {
      setError("Preview first and provide a correction reason of at least 10 characters.");
      return;
    }
    if (!previewOnly && !window.confirm(
      "Correct this posted Opening Balance account identity?\n\nOriginal posted journals and ledger rows will remain unchanged. " +
      "This is NOT physical deletion. The original name and code are retained in the Owner Audit Trail."
    )) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "owner_correct_opening_only_account",
        {
          p_account_id: accountId,
          p_new_name: newName.trim(),
          p_new_code: newCode.trim(),
          p_new_parent_id: parentId,
          p_reason: reason.trim(),
          p_preview: previewOnly,
        }
      );
      if (rpcError) throw new Error(rpcError.message);
      if (previewOnly) {
        if (!data?.eligible) throw new Error("Account is not eligible for an opening-only identity correction.");
        setPreview(data as Preview);
      } else {
        if (!data?.success) throw new Error("Server did not confirm the correction.");
        setPreview(null);
        setResult("Opening account classification corrected. Original posted balance is preserved; no journal was duplicated.");
        await onCompleted();
      }
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Correction could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3" data-no-print data-no-export>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Software Owner · Posted Opening Account Correction</h3>
          <p className="text-xs text-slate-600">
            Replace a wrong account name/code/classification in place. Only opening-only accounts qualify; posted evidence is never deleted.
          </p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
          {open ? "Close" : "Correct Opening Account"}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-amber-200 pt-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Wrong posted Opening Account
              <select className="input mt-1 w-full" value={accountId} onChange={(e) => chooseSource(e.target.value)}>
                <option value="">Select wrong account</option>
                {sourceAccounts.map((a) =>
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                )}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">New Parent — Asset / Receivables Group
              <select className="input mt-1 w-full" value={parentId}
                onChange={(e) => { setParentId(e.target.value); resetPreview(); }}>
                <option value="">Select Asset group</option>
                {assetGroups.filter((a) => a.id !== accountId).map((a) =>
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                )}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">Correct Ledger Name
              <input className="input mt-1 w-full" value={newName} maxLength={160}
                onChange={(e) => { setNewName(e.target.value); resetPreview(); }} />
            </label>
            <label className="text-xs font-semibold text-slate-700">Correct Ledger Code
              <input className="input mt-1 w-full" value={newCode} maxLength={32}
                onChange={(e) => { setNewCode(e.target.value); resetPreview(); }} />
            </label>
          </div>
          <label className="block text-xs font-semibold text-slate-700">Owner Correction Reason (min. 10 characters)
            <textarea className="input mt-1 w-full" rows={2} value={reason} maxLength={500}
              placeholder="Why was this opening account created under the wrong ledger?"
              onChange={(e) => { setReason(e.target.value); resetPreview(); }} />
          </label>
          <p className="text-xs text-amber-900">
            Important: this is an in-place replacement of the COA identity, not physical account deletion or a new opening posting.
            Customer-linked, mapped, system, or otherwise used accounts are deliberately blocked.
            The new parent must be an actual Asset group, not an A/R posting account.
          </p>
          {preview && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-slate-800">
              <strong>Verified preview:</strong> {preview.old_code} · {preview.old_name} → {preview.new_code} · {preview.new_name}
              <div className="mt-1">Parent: {preview.new_parent} · Opening Debit: {Number(preview.opening_debit).toLocaleString(undefined, {minimumFractionDigits:2})}
                {" · "}Opening Credit: {Number(preview.opening_credit).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
              <div className="mt-1">Existing opening journal stays unchanged; net opening Debit: {Number(preview.net_debit).toLocaleString(undefined, {minimumFractionDigits:2})}.</div>
            </div>
          )}
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">{error}</p>}
          {result && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs font-semibold text-emerald-800">{result}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? "Checking…" : "Preview & Verify"}
            </button>
            <button type="button" disabled={busy || !preview} onClick={() => void run(false)}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              Confirm Owner Correction
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
