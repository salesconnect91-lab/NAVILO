-- The abandoned bookkeeping source table was removed on 06-Oct.
-- Keep duplicate protection through external invoice evidence, billed trips and Sales invoice numbers.
begin;
create or replace function public.transport_preview_external_invoices(p_source_company text,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();x jsonb;st text;reason text;cid uuid;vid uuid;dt date;tax numeric;amt numeric;output jsonb:='[]';
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','create');
 if c is null or b is null or loc is null or not exists(select 1 from public.business_units where id=b and company_id=c and unit_type='transport' and is_active) then raise exception 'Active Transport workspace and branch required';end if;
 if nullif(btrim(p_source_company),'') is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Source Company and 1 to 500 lines required';end if;
 for x in select value from jsonb_array_elements(p_rows) loop
 st:='New';reason:='';cid:=null;vid:=null;
 begin
 dt:=(x->>'invoice_date')::date;amt:=(x->>'amount')::numeric;tax:=(x->>'tax_percent')::numeric;
 if dt is null or amt is null or amt<=0 or amt<>round(amt,2) or tax is null or tax not between 0 and 100 or nullif(btrim(x->>'source_reference'),'') is null or nullif(btrim(x->>'description'),'') is null or x->>'sale_type' not in ('Cash','Credit') or x->>'sale_type' is null then raise exception 'Date, positive two-decimal Amount, Reference, Description and Cash/Credit required';end if;
 if (x->>'sale_type'='Cash' and tax<>0) or (x->>'sale_type'='Credit' and (tax<=0 or nullif(btrim(x->>'invoice_no'),'') is null)) then raise exception 'Credit requires Invoice No and VAT; Cash requires zero VAT';end if;
 if coalesce((x->>'tax_amount')::numeric,-1)<>round(amt*tax/100,2) or coalesce((x->>'bill_amount')::numeric,-1)<>amt+round(amt*tax/100,2) then raise exception 'Source net, VAT and gross do not reconcile';end if;
 if tax>0 and public.fixed_tax_rate_on(c,'sales',dt) is null then raise exception 'No active Sales VAT rate for invoice date. Configure VAT in Tax Settings';end if;
 if tax>0 and tax is distinct from public.fixed_tax_rate_on(c,'sales',dt) then raise exception 'Source VAT does not match effective invoice-date VAT rate';end if;
 if (select count(*) from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(x->>'customer')))<>1 then raise exception 'Customer must match exactly one active master';end if;
 select id into cid from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(x->>'customer'));
 if (select count(*) from public.transport_vehicles where company_id=c and business_unit_id=b and is_active and lower(btrim(vehicle_no))=lower(btrim(x->>'vehicle_no')))<>1 then raise exception 'Vehicle must match exactly one active master';end if;
 select id into vid from public.transport_vehicles where company_id=c and business_unit_id=b and is_active and lower(btrim(vehicle_no))=lower(btrim(x->>'vehicle_no'));
 if (select count(*) from jsonb_array_elements(p_rows) y where lower(btrim(y->>'source_reference'))=lower(btrim(x->>'source_reference')))<>1 then raise exception 'Duplicate source reference in file';end if;
 if nullif(btrim(x->>'invoice_no'),'') is not null and exists(select 1 from jsonb_array_elements(p_rows) y where lower(btrim(y->>'invoice_no'))=lower(btrim(x->>'invoice_no')) and (lower(btrim(y->>'customer')) is distinct from lower(btrim(x->>'customer')) or y->>'invoice_date' is distinct from x->>'invoice_date' or y->>'sale_type' is distinct from x->>'sale_type' or (y->>'tax_percent')::numeric is distinct from tax)) then raise exception 'Invoice lines disagree on Customer, Date, Cash/Credit or VAT';end if;
 if exists(select 1 from public.transport_external_invoice_lines e where e.company_id=c and e.business_unit_id=b and e.source_company=lower(btrim(p_source_company)) and e.source_reference=lower(btrim(x->>'source_reference'))) or exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and lower(btrim(t.transport_source_company))=lower(btrim(p_source_company)) and lower(btrim(t.transport_source_trip_id))=lower(btrim(x->>'reference_trip_no')) and t.sales_order_id is not null) then st:='Duplicate';reason:='Source line is already billed';
 elsif nullif(btrim(x->>'invoice_no'),'') is not null and exists(select 1 from public.sales_orders where company_id=c and business_unit_id=b and lower(btrim(order_no))=lower(btrim(x->>'invoice_no'))) then st:='Duplicate';reason:='Invoice number already exists';end if;
 exception when others then st:='Error';reason:=sqlerrm;end;
 output:=output||jsonb_build_array(x||jsonb_build_object('import_status',st,'import_reason',reason));
 end loop;
 return jsonb_build_object('rows',output);
end $$;
revoke all on function public.transport_preview_external_invoices(text,jsonb) from public,anon;grant execute on function public.transport_preview_external_invoices(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
