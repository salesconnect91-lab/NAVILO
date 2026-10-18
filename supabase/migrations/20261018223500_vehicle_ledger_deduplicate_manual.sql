-- Reconcile new vehicle GL projection against pre-existing manual contribution events.
-- Prevent a posted vehicle expense/manual journal line from appearing twice.
DO $navilo$
DECLARE f text;
DECLARE needle text:='AND coalesce(j.trans_type,'''') IN ('''',''Journal Entry'',''Manual Journal'',''Journal Reversal'')';
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='transport_vehicle_ledger';
 IF md5(f) IS DISTINCT FROM '6317c34420a68248e20c8196c0af18f4'
 THEN RAISE EXCEPTION 'Vehicle GL projection changed; refuse duplicate guard patch'; END IF;
 IF position(needle IN f)=0
 THEN RAISE EXCEPTION 'Vehicle GL projection anchor missing'; END IF;
 EXECUTE replace(f,needle,needle || $extra$
   AND NOT EXISTS(
     SELECT 1 FROM public.transport_vehicle_contributions already
     WHERE already.company_id=c AND already.business_unit_id=b
       AND already.operating_location_id=loc AND already.account_id=p_vehicle
       AND already.event_id=('vehicle-manual:'||l.id::text)
   )
$extra$);
END
$navilo$;
