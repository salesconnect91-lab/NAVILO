-- Read-only preview for Transport Sales invoice Excel imports.
create or replace function public.transport_preview_customer_invoice_batch(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); r jsonb; out_rows jsonb:='[]'::jsonb;
v_status text; v_reason text; v_customer uuid; v_trip public.transport_trips%rowtype; v_vehicle text;
begin
 perform public.assert_module_permission('sales','create'); perform public.transport_finance_assert('billing');
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Invoice rows must be an array'; end if;
 if jsonb_array_length(p_rows)>500 then raise exception 'Maximum 500 invoice rows per file'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  v_status:='New'; v_reason:=null; v_customer:=null; v_trip:=null; v_vehicle:=null;
  if nullif(btrim(r->>'invoice_no'),'') is null or nullif(r->>'invoice_date','') is null or nullif(btrim(r->>'customer'),'') is null or nullif(btrim(r->>'trip_no'),'') is null or nullif(btrim(r->>'vehicle_no'),'') is null or coalesce(nullif(r->>'amount','')::numeric,0)<=0 then
    v_status:='Error'; v_reason:='Required invoice fields are missing or Amount is invalid';
  else
    select x.id into v_customer from public.customers x where x.company_id=c and lower(btrim(x.name))=lower(btrim(r->>'customer')) limit 1;
    if v_customer is null then v_status:='Error'; v_reason:='Customer not found';
    elsif exists(select 1 from public.sales_orders s where s.company_id=c and s.business_unit_id=b and lower(btrim(s.order_no))=lower(btrim(r->>'invoice_no'))) then v_status:='Duplicate'; v_reason:='Invoice No already exists';
    else
      select * into v_trip from public.transport_trips t where t.company_id=c and t.business_unit_id=b and lower(btrim(t.trip_no))=lower(btrim(r->>'trip_no')) limit 1;
      if v_trip.id is null then v_status:='Error'; v_reason:='Trip not found';
      elsif v_trip.customer_id is distinct from v_customer then v_status:='Error'; v_reason:='Trip Customer does not match invoice Customer';
      elsif v_trip.sales_order_id is not null or exists(select 1 from public.sales_service_lines l where l.source_module='transport_trip' and l.source_id=v_trip.id) then v_status:='Duplicate'; v_reason:='Trip is already linked to a Sales Invoice';
      else
        select v.vehicle_no into v_vehicle from public.transport_vehicles v where v.id=v_trip.vehicle_id and v.company_id=c and v.business_unit_id=b;
        if v_vehicle is null or lower(btrim(v_vehicle))<>lower(btrim(r->>'vehicle_no')) then v_status:='Error'; v_reason:='Vehicle No does not match Trip'; end if;
      end if;
    end if;
  end if;
  out_rows:=out_rows||jsonb_build_array(r||jsonb_build_object('import_status',v_status,'import_reason',v_reason));
 end loop;
 return jsonb_build_object('rows',out_rows,'new',coalesce((select count(*) from jsonb_array_elements(out_rows) x where x->>'import_status'='New'),0),'duplicate',coalesce((select count(*) from jsonb_array_elements(out_rows) x where x->>'import_status'='Duplicate'),0),'error',coalesce((select count(*) from jsonb_array_elements(out_rows) x where x->>'import_status'='Error'),0));
end$$;
revoke all on function public.transport_preview_customer_invoice_batch(jsonb) from public;
grant execute on function public.transport_preview_customer_invoice_batch(jsonb) to authenticated;
