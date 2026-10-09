import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";

type OwnerEvent = {
  id: string;
  document_id: string;
  reason: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export default function OwnerJournalAuditHistory() {
  const { activeCompany, activeBusinessUnit } = useAuth();
  const [events, setEvents] = useState<OwnerEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setEvents([]);
    setError("");
    if (!activeCompany?.company_id || !activeBusinessUnit?.business_unit_id) return;
    void (async () => {
      const { data: owner, error: permissionError } = await supabase.rpc("owner_posted_control_access");
      if (!alive || permissionError || owner !== true) return;
      const { data, error: fetchError } = await supabase
        .from("owner_posted_control_events")
        .select("id,document_id,reason,created_at,metadata")
        .eq("document_type", "manual_journal")
        .eq("action_type", "cancel")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!alive) return;
      if (fetchError) setError(fetchError.message);
      else setEvents((data ?? []) as OwnerEvent[]);
    })();
    return () => { alive = false; };
  }, [activeCompany?.company_id, activeBusinessUnit?.business_unit_id]);
  if (events.length === 0 && !error) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <button type="button" className="text-sm font-semibold text-slate-700"
        onClick={() => setOpen((previous) => !previous)}>
        Owner Audit History · {events.length} cancelled journal(s) {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {error && <p className="text-rose-700">{error}</p>}
          {events.map((event) => (
            <div key={event.id} className="border-t border-slate-100 pt-2">
              <span className="font-semibold">
                {String(event.metadata?.original_entry_no ?? event.document_id)}
              </span>
              {" · "}{new Date(event.created_at).toLocaleString()}
              {" · "}{event.reason}
              <Link className="ml-2 text-blue-700 underline"
                to={`/accounting/${event.document_id}`}>Audit entry</Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
