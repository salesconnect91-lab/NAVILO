-- Forward-only function correction; no production row mutation.
-- Credit Transport imports must supply their actual source Sales invoice number.
-- A missing source reference is rejected instead of inventing H-S or a new number.
DO $guard$
DECLARE src text; needle text; replacement text;
BEGIN
 src:=pg_get_functiondef('public.transport_import_history_batch(uuid,integer,jsonb)'::regprocedure);
 needle:=$match$bill:=public.transport_post_customer_bill(t,(v->>'customer_date')::date,(v->>'customer_vat')::boolean);$match$;
 replacement:=$replace$
if (select lower(sale_type::text) from public.transport_trips where id=t)='credit' then
   if nullif(btrim(trip_data->>'source_invoice_no'),'') is null then
      raise exception 'Credit history import requires the original Sales invoice number';
   end if;
   bill:=public.transport_post_customer_bill_numbered(t,(v->>'customer_date')::date,
       (v->>'customer_vat')::boolean,btrim(trip_data->>'source_invoice_no'));
else
   bill:=public.transport_post_customer_bill(t,(v->>'customer_date')::date,(v->>'customer_vat')::boolean);
end if;$replace$;
 IF position('Credit history import requires the original Sales invoice number' in src)=0 THEN
   IF position(needle in src)=0 THEN
      RAISE EXCEPTION 'Unable to locate canonical history customer billing call';
   END IF;
   EXECUTE replace(src,needle,replacement);
 END IF;
END $guard$;
