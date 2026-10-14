-- Register payment cells and their filters/sorting/totals must use money settled,
-- including VAT, consistently before and after native invoice conversion.
begin;
do $patch$ declare f text; begin
 f:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 if (length(f)-length(replace(f,'coalesce(r.supplier_paid_net,0)','')))/length('coalesce(r.supplier_paid_net,0)')<>3
 or (length(f)-length(replace(f,'coalesce(r.received_from_company,0)','')))/length('coalesce(r.received_from_company,0)')<>3 then
  raise exception 'Register payment projection changed; inspect before applying';
 end if;
 f:=replace(f,'coalesce(r.supplier_paid_net,0)','coalesce(r.payment_amount,0)');
 f:=replace(f,'coalesce(r.received_from_company,0)','coalesce(r.customer_received_gross,0)');
 execute f;
end $patch$;
notify pgrst,'reload schema';
commit;
