-- NAVILO AUD-02: least-privilege access for Transport driver audit/RPC surfaces.
-- Does not alter data, triggers, views' definitions, or financial formulas.
REVOKE SELECT ON TABLE public.transport_driver_month_trip_costs FROM anon;
REVOKE EXECUTE ON FUNCTION public.transport_driver_add_adjustment(uuid,date,text,numeric,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_driver_add_adjustment(uuid,date,text,numeric,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_driver_month_detail(uuid,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_driver_trip_pay_status(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_audit_branch_fill() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_link_imported_sales_on_post() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_supplier_posting_guard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_trip_branch_guard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transport_trip_customer_mode_guard() FROM PUBLIC, anon;
-- Restore/retain only explicit authenticated access for the four direct RPC signatures.
GRANT EXECUTE ON FUNCTION public.transport_driver_add_adjustment(uuid,date,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transport_driver_add_adjustment(uuid,date,text,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transport_driver_month_detail(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transport_driver_trip_pay_status(uuid) TO authenticated;
