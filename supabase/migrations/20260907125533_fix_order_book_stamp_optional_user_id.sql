create or replace function public.order_book_stamp_context()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_user uuid:=public.legacy_data_user_id();
  v_row jsonb;
begin
  if v_company is null then raise exception 'No active company selected.'; end if;
  if v_bu is null then raise exception 'No active business unit selected.'; end if;
  if v_user is null then raise exception 'Authentication required.'; end if;

  v_row := to_jsonb(new);
  if coalesce(v_row->>'company_id','') = '' then
    v_row := jsonb_set(v_row,'{company_id}',to_jsonb(v_company),true);
  elsif (v_row->>'company_id')::uuid <> v_company then
    raise exception 'Cross-company write denied.';
  end if;

  if coalesce(v_row->>'business_unit_id','') = '' then
    v_row := jsonb_set(v_row,'{business_unit_id}',to_jsonb(v_bu),true);
  elsif (v_row->>'business_unit_id')::uuid <> v_bu then
    raise exception 'Cross-business-unit write denied.';
  end if;

  if v_row ? 'user_id' then
    v_row := jsonb_set(v_row,'{user_id}',to_jsonb(v_user),true);
  end if;

  new := jsonb_populate_record(new,v_row);
  return new;
end
$function$;