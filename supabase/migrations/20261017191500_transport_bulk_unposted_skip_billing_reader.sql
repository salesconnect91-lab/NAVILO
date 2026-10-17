-- Forward-only, read-only query optimization; no source rows are modified.
-- When the New Sales Invoice list is unposted-only, no row has a customer
-- billing document. Its billed_customer_net is therefore NULL by definition.
-- Avoid the expensive transport_financial_register aggregate in that mode.
DO $migration$
DECLARE
 definition text;
 target text := 'case when p_side=''customer'' then (select r.billed_customer_net from public.transport_financial_register r where r.id=t.id) end billed_customer_net';
 revised text;
BEGIN
 definition:=pg_get_functiondef('public.transport_bulk_rate_page(text,integer,integer,jsonb)'::regprocedure);
 IF position('skip_bulk_billed_lookup' in definition)>0 THEN RETURN; END IF;
 IF length(definition)-length(replace(definition,target,''))<>length(target) THEN
   RAISE EXCEPTION 'Canonical bulk-rate billed lookup changed; no unsafe replacement';
 END IF;
 revised:=replace(definition,target,
  'case when p_side=''customer'' and coalesce(p_filters->>''unpostedOnly'',''false'')<>''true'' then '
  ||'(select r.billed_customer_net from public.transport_financial_register r where r.id=t.id) '
  ||'end billed_customer_net /* skip_bulk_billed_lookup */');
 EXECUTE revised;
END $migration$;
