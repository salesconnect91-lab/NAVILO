-- Preserve existing authorization. Return the viewer's actual finance permissions
-- with the operational recovery response so the ORIGINAL Register headings persist.
-- No changes to Trips, invoices, payments, journals or account balances.
DO $patch$
DECLARE
 fn text := pg_get_functiondef('public.transport_register_operational_recovery(integer,integer,text)'::regprocedure);
 old text := $old$'count',(SELECT count(*) FROM matched),'recovery_only',true$old$;
 newval text := $new$'count',(SELECT count(*) FROM matched),'recovery_only',true,
  'permissions',jsonb_build_object(
    'customer',public.transport_financial_read_allowed('customer'),
    'supplier',public.transport_financial_read_allowed('supplier'))$new$;
BEGIN
 IF position(newval IN fn)>0 THEN RAISE NOTICE 'Permission-aware operational recovery already active'; RETURN; END IF;
 IF (length(fn)-length(replace(fn,old,'')))/length(old)<>1 THEN
   RAISE EXCEPTION 'Unexpected operational recovery RPC baseline';
 END IF;
 EXECUTE replace(fn,old,newval);
END
$patch$;