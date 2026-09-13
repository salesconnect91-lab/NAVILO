create or replace function public.propagate_operating_location_from_parent()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_parent_id uuid;
  v_found_id uuid;
  v_location uuid;
begin
  if current_setting('app.maintenance_reset',true)='1' then return new; end if;
  v_parent_id:=nullif(to_jsonb(new)->>tg_argv[1],'')::uuid;
  if v_parent_id is null then
    raise exception 'Parent record is required for branch-scoped child row.';
  end if;
  execute format('select id, operating_location_id from public.%I where id=$1',tg_argv[0])
    into v_found_id,v_location using v_parent_id;
  if v_found_id is null then
    raise exception 'Parent record not found for branch-scoped child row.';
  end if;
  if v_location is null then
    raise exception 'Parent transaction has no active branch/location.';
  end if;
  new.operating_location_id:=v_location;
  return new;
end
$$;
