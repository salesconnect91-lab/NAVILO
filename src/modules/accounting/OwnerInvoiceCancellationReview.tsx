import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { userFacingError } from "@/lib/errorMessage";

type Review = {
  document_no: string;
  can_cancel: boolean;
  reasons: string[];
  paid_amount: number;
  linked_journals: number;
  stock_movements: number;
  payment_allocations: number;
  transport_documents: number;
};

/**
 * Owner-only, read-only review. Never alters a posted invoice or offers a
 * generic cancel action before domain-specific stock/VAT/transport reversal is proven.
 */
export default function OwnerInvoiceCancellationReview({
  side,
  documentId,
  posted,
}: {
  side: "sales" | "purchase";
  documentId: string;
  posted: boolean;
}) {
  const { isPlatformOwner } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setOpen(false);
    setReview(null);
    setError("");
  }, [side, documentId]);

  if (!isPlatformOwner || !posted) return null;

  const inspect = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setBusy(true);
    setError("");
    setReview(null);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "owner_posted_invoice_cancellation_review",
        { p_document_type: side, p_document_id: documentId },
      );
      if (rpcError) throw rpcError;
      if (!data || typeof data !== "object" || !Array.isArray((data as Review).reasons)) {
        throw new Error("Owner review returned invalid data.");
      }
      setReview(data as Review);
    } catch (e: unknown) {
      setError(userFacingError(e, "Unable to review posted invoice dependencies."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={() => void inspect()}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
        aria-expanded={open}
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        Owner Cancellation Review
      </button>
      {open && (
        <div className="mt-2 max-w-2xl rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-700" role="region" aria-label="Posted invoice cancellation review">
          {busy && <p>Checking journal, payments, stock and transport links…</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
          {review && (
            <>
              <p className="font-semibold text-slate-900">
                {review.document_no} · {review.can_cancel ? "Eligible" : "Direct cancellation blocked"}
              </p>
              <p className="mt-1 text-slate-600">
                Posted journals: {review.linked_journals} · Payment allocations: {review.payment_allocations}
                {" · "}Stock movements: {review.stock_movements} · Transport links: {review.transport_documents}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {review.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
              </ul>
              <p className="mt-2 font-medium">
                Original posted records remain immutable. Use the relevant credit/debit note or Trip Finance correction workflow.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
