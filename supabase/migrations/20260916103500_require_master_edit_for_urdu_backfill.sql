create or replace function public.backfill_company_urdu_names()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company uuid := public.current_company_id();
  v_count integer := 0;
  v_total integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_company is null then
    raise exception 'No active company selected';
  end if;
  if not public.has_module_permission(v_company, 'master', 'edit') then
    raise exception 'Master data edit permission required';
  end if;

  update public.customers set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.suppliers set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.items set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.categories set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.uom set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.transporters set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.warehouses set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.godowns set name_urdu = public.english_to_urdu_name(name) where company_id=v_company and nullif(btrim(name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;
  update public.charge_master set charge_name_urdu = public.english_to_urdu_name(charge_name) where company_id=v_company and nullif(btrim(charge_name_urdu),'') is null; get diagnostics v_count=row_count; v_total:=v_total+v_count;

  return jsonb_build_object('updated_rows',v_total,'company_id',v_company);
end;
$function$;

revoke all on function public.backfill_company_urdu_names() from public, anon;
grant execute on function public.backfill_company_urdu_names() to authenticated, service_role;
