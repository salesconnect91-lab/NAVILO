import { supabase } from "@/lib/supabase";

/** Match the database's effective-date ordering for fixed invoice rates. */
export async function fixedTaxRateOn(date: string, context: "sales" | "purchase"): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { data, error } = await supabase.from("tax_rates")
    .select("id,rate,effective_from,effective_to,created_at")
    .eq("is_active", true).eq("is_fixed", true)
    .in("applies_to", [context, "both"])
    .or(`effective_from.is.null,effective_from.lte.${date}`)
    .or(`effective_to.is.null,effective_to.gte.${date}`)
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  return data ? String(Number(data.rate)) : null;
}
