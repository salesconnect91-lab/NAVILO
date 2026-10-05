-- Atomic batch wrapper for Transport trip expense Excel imports.
-- Any invalid row rolls back the entire file transaction.
create or replace function public.transport_post_trip_expense_batch(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_row jsonb; v_result jsonb; v_count integer:=0; v_seen text[]:=array[]::text[];
  v_ref text; v_trip_id uuid; v_supplier_id uuid;
begin
  perform public.assert_module_permission('transport','edit');
  perform public.assert_module_permission('accounting','create');
  perform public.assert_module_permission('accounting','post');
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Expense rows are required.'; end if;
  if jsonb_array_length(p_rows)>500 then raise exception 'Maximum 500 expense rows per file.'; end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_ref:=lower(btrim(coalesce(v_row->>'source_reference','')));
    if v_ref='' then raise exception 'Source reference is required.'; end if;
    if v_ref=any(v_seen) then raise exception 'Duplicate Source Reference in file: %',v_row->>'source_reference'; end if;
    v_seen:=array_append(v_seen,v_ref);
    select t.id into v_trip_id from public.transport_trips t
      where t.company_id=public.current_company_id() and t.business_unit_id=public.current_business_unit_id()
        and lower(btrim(t.trip_no))=lower(btrim(coalesce(v_row->>'trip_no',''))) limit 1;
    if v_trip_id is null then raise exception 'Trip not found: %',v_row->>'trip_no'; end if;
    v_supplier_id:=null;
    if nullif(btrim(coalesce(v_row->>'supplier','')),'') is not null then
      select s.id into v_supplier_id from public.suppliers s
       where s.company_id=public.current_company_id() and lower(btrim(s.name))=lower(btrim(v_row->>'supplier')) limit 1;
      if v_supplier_id is null then raise exception 'Supplier not found: %',v_row->>'supplier'; end if;
    end if;
    v_result:=public.transport_post_trip_expense(
      v_trip_id,(v_row->>'expense_date')::date,v_row->>'expense_type',(v_row->>'amount')::numeric,
      v_row->>'payment_method',v_row->>'source_reference',nullif(btrim(coalesce(v_row->>'description','')),''),v_supplier_id
    );
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('success',true,'posted',v_count);
end$$;
revoke all on function public.transport_post_trip_expense_batch(jsonb) from public;
grant execute on function public.transport_post_trip_expense_batch(jsonb) to authenticated;
