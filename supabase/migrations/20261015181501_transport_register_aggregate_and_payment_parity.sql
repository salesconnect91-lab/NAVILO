-- Expose grouped Trip keys to the planner instead of losing their uniqueness
-- at six CTE fences. Keep the authoritative source and filtered rows shared.
-- Restore gross payment parity for databases missing the earlier correction.
do $repair$
declare
 definition text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 key text;
 old_projection text;
 replacement text;
 occurrences integer;
begin
 foreach key in array array['agreed_rents','customer_charge_agg','supplier_charge_agg',
   'customer_invoice_agg','supplier_invoice_agg','supplier_status_agg'] loop
  old_projection:=key||' as materialized (';
  if position(old_projection in definition)>0 then
   definition:=replace(definition,old_projection,key||' as not materialized (');
  elsif position(key||' as not materialized (' in definition)=0 then
   raise exception 'Register aggregate % changed; inspect before applying',key;
  end if;
 end loop;
 foreach key in array array['supplier','customer'] loop
  if key='supplier' then
   old_projection:='coalesce(r.supplier_paid_net,0)';
   replacement:='coalesce(r.payment_amount,0)';
  else
   old_projection:='coalesce(r.received_from_company,0)';
   replacement:='coalesce(r.customer_received_gross,0)';
  end if;
  occurrences:=(length(definition)-length(replace(definition,old_projection,'')))/length(old_projection);
  if occurrences=3 then
   definition:=replace(definition,old_projection,replacement);
  elsif occurrences<>0 or position(replacement in definition)=0 then
   raise exception 'Register % payment projection changed; inspect before applying',key;
  end if;
 end loop;
 execute definition;
end
$repair$;
notify pgrst,'reload schema';
