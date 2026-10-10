-- Transport only: derive trip-linked imported Sales draft's mode from its Customer Master.
-- This changes new draft creation only, never posted invoices or historical accounting.
do $$
declare definition text;v_old text;v_new text;
begin
 select pg_get_functiondef(p.oid) into definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_import_customer_invoice_draft';
 if definition is null then raise exception 'Missing Transport invoice import function';end if;
 v_old:='imported_count integer:=0;';
 v_new:='imported_count integer:=0;v_mode text;';
 if position(v_old in definition)=0 then raise exception 'Transport draft import variable anchor changed';end if;
 definition:=replace(definition,v_old,v_new);
 v_old:=' if exists(select 1 from public.sales_orders where company_id=c and business_unit_id=b and lower(btrim(order_no))=lower(btrim(p_invoice_no))) then';
 v_new:=' v_mode:=initcap(public.transport_trip_customer_sale_type(c,b,p_customer_id));'
 ||E'\n if exists(select 1 from jsonb_array_elements(p_rows) x join public.transport_trips t'
 ||E'\n   on t.company_id=c and t.business_unit_id=b and lower(btrim(t.trip_no))=lower(btrim(x->>''trip_no''))'
 ||E'\n   where t.sale_type is distinct from lower(v_mode))'
 ||E'\n then raise exception ''Imported Trip billing modes do not match Transport Customer Master'';end if;'
 ||E'\n'||v_old;
 if position(v_old in definition)=0 then raise exception 'Transport draft import validation anchor changed';end if;
 definition:=replace(definition,v_old,v_new);
 v_old:='tax,base,1,''service'',''Credit'',u) returning id into oid;';
 v_new:='tax,base,1,''service'',v_mode,u) returning id into oid;';
 if position(v_old in definition)=0 then raise exception 'Transport draft import invoice mode anchor changed';end if;
 definition:=replace(definition,v_old,v_new);
 execute definition;
end $$;
notify pgrst,'reload schema';
