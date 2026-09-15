-- Priority 1: reporting views execute as invoker so underlying tenant RLS applies.
ALTER VIEW public.customer_item_history_report SET (security_invoker = true);
ALTER VIEW public.sales_margin_report SET (security_invoker = true);
REVOKE ALL ON public.customer_item_history_report FROM anon;
REVOKE ALL ON public.sales_margin_report FROM anon;
GRANT SELECT ON public.customer_item_history_report TO authenticated;
GRANT SELECT ON public.sales_margin_report TO authenticated;
