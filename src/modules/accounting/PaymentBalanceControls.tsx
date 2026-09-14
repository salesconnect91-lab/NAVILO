import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type VisibilityState = {
  show_previous_balance: boolean;
  show_closing_balance: boolean;
};

const DEFAULTS: VisibilityState = {
  show_previous_balance: true,
  show_closing_balance: true,
};

export default function PaymentBalanceControls() {
  const [visibility, setVisibility] = useState<VisibilityState>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<keyof VisibilityState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication required.");

      const { data, error } = await supabase
        .from("document_print_visibility")
        .select("show_previous_balance,show_closing_balance")
        .eq("document_type", "receipt_payment")
        .maybeSingle();

      if (error) throw error;

      setVisibility({
        show_previous_balance: data?.show_previous_balance ?? true,
        show_closing_balance: data?.show_closing_balance ?? true,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to load balance visibility settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (key: keyof VisibilityState) => {
    const next = { ...visibility, [key]: !visibility[key] };
    setSavingKey(key);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication required.");

      const { data: existing, error: readError } = await supabase
        .from("document_print_visibility")
        .select("id")
        .eq("document_type", "receipt_payment")
        .maybeSingle();

      if (readError) throw readError;

      const payload = {
        show_previous_balance: next.show_previous_balance,
        show_closing_balance: next.show_closing_balance,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error: updateError } = await supabase
          .from("document_print_visibility")
          .update(payload)
          .eq("id", existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("document_print_visibility")
          .insert({
            user_id: user.id,
            document_type: "receipt_payment",
            show_company_name: true,
            show_logo: true,
            show_address: true,
            show_phone_email: true,
            show_tax_details: true,
            show_header: true,
            show_footer: true,
            show_signatures: true,
            show_print_datetime: false,
            show_page_numbers: true,
            ...payload,
          });
        if (insertError) throw insertError;
      }

      setVisibility(next);
    } catch (err: any) {
      setError(err?.message || "Failed to save balance visibility.");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div data-no-print data-no-export className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading slip controls...
      </div>
    );
  }

  return (
    <section data-no-print data-no-export className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-900">Slip Balance Show / Hide / سلپ بیلنس شو ہائیڈ</h3>
        <p className="mt-1 text-xs text-slate-500">Applies to Customer Receipt and Supplier Payment print layouts only. / کسٹمر وصولی اور سپلائر ادائیگی</p>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        {([
          ["show_previous_balance", "Previous Balance / سابقہ بیلنس"],
          ["show_closing_balance", "Closing Balance / بقایا بیلنس"],
        ] as Array<[keyof VisibilityState, string]>).map(([key, label]) => {
          const enabled = visibility[key];
          return (
            <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <span className="text-xs font-semibold text-slate-700">{label}</span>
              <button
                type="button"
                disabled={savingKey !== null}
                onClick={() => void toggle(key)}
                aria-pressed={enabled}
                className={`inline-flex min-w-[90px] items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"} disabled:opacity-50`}
              >
                {savingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : enabled ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                {enabled ? "Show" : "Hide"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
