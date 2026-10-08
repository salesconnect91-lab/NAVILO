-- Only extend the existing search predicate; preserve the deployed function and security checks.
DO $migration$
DECLARE definition text; old_predicate text := $old$   and (coalesce(btrim(p_filters->>'search'),'')='' or position(
     lower(replace(btrim(p_filters->>'search'),',',''))
     in lower(replace(concat_ws(' ',
       x.vals->'cells'->>'trip_no',x.vals->'cells'->>'trip_date',x.vals->'cells'->>'truck_type',
       x.vals->'cells'->>'job_no',x.vals->'cells'->>'invoiced',x.vals->'cells'->>'company',
       x.vals->'cells'->>'driver',x.vals->'cells'->>'owner',x.vals->'cells'->>'plate',
       x.vals->'cells'->>'from',x.vals->'cells'->>'to',x.vals->'cells'->>'charge',x.vals->'cells'->>'supplier_charge',x.vals->'cells'->>'supplier_charges',x.vals->'cells'->>'paper_received_by',
       x.vals->'cells'->>'rent_driver',x.vals->'cells'->>'supplier_paid',x.vals->'cells'->>'supplier_balance',
       x.vals->'cells'->>'supplier_credit',x.vals->'cells'->>'driver_pay',x.vals->'cells'->>'driver_paid',
       x.vals->'cells'->>'driver_balance',x.vals->'cells'->>'payment_date',x.vals->'cells'->>'amount',
       x.vals->'cells'->>'company_rate',x.vals->'cells'->>'received_company',x.vals->'cells'->>'remaining_company',
       x.vals->'cells'->>'customer_credit',x.vals->'cells'->>'profit',x.vals->'cells'->>'commission',
       x.vals->'cells'->>'invoice_no',x.vals->'cells'->>'supplier_invoice_no',x.vals->'cells'->>'sale_type',x.status,x.ppr_status
     ),',',''))
   )>0)$old$; new_predicate text := $new$   and (coalesce(btrim(p_filters->>'search'),'')='' or case when p_filters->>'searchMode'='starts_with' then
     exists (
       select 1 from jsonb_each_text(x.vals->'cells'||jsonb_build_object('status',x.status,'ppr_status',x.ppr_status)) cell
       cross join lateral (
         select lower(replace(btrim(cell.value),',','')) value
         union all
         select word from regexp_split_to_table(lower(replace(btrim(cell.value),',','')), '[[:space:]]+') word
       ) candidate
       where left(candidate.value,length(lower(replace(btrim(p_filters->>'search'),',',''))))=lower(replace(btrim(p_filters->>'search'),',',''))
     )
     else position(
     lower(replace(btrim(p_filters->>'search'),',',''))
     in lower(replace(concat_ws(' ',
       x.vals->'cells'->>'trip_no',x.vals->'cells'->>'trip_date',x.vals->'cells'->>'truck_type',
       x.vals->'cells'->>'job_no',x.vals->'cells'->>'invoiced',x.vals->'cells'->>'company',
       x.vals->'cells'->>'driver',x.vals->'cells'->>'owner',x.vals->'cells'->>'plate',
       x.vals->'cells'->>'from',x.vals->'cells'->>'to',x.vals->'cells'->>'charge',x.vals->'cells'->>'supplier_charge',x.vals->'cells'->>'supplier_charges',x.vals->'cells'->>'paper_received_by',
       x.vals->'cells'->>'rent_driver',x.vals->'cells'->>'supplier_paid',x.vals->'cells'->>'supplier_balance',
       x.vals->'cells'->>'supplier_credit',x.vals->'cells'->>'driver_pay',x.vals->'cells'->>'driver_paid',
       x.vals->'cells'->>'driver_balance',x.vals->'cells'->>'payment_date',x.vals->'cells'->>'amount',
       x.vals->'cells'->>'company_rate',x.vals->'cells'->>'received_company',x.vals->'cells'->>'remaining_company',
       x.vals->'cells'->>'customer_credit',x.vals->'cells'->>'profit',x.vals->'cells'->>'commission',
       x.vals->'cells'->>'invoice_no',x.vals->'cells'->>'supplier_invoice_no',x.vals->'cells'->>'sale_type',x.status,x.ppr_status
     ),',',''))
   )>0 end)$new$;
BEGIN
 definition := pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 IF position(old_predicate in definition)=0 THEN RAISE EXCEPTION 'Register search predicate changed; reconcile before applying'; END IF;
 EXECUTE replace(definition,old_predicate,new_predicate);
END $migration$;
