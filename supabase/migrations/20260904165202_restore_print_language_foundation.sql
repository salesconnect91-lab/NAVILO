-- Restore legacy print-language compatibility required by the later global-language migration.
-- The original production migration also replaced the Urdu backfill RPC; that RPC is
-- already supplied by the existing Urdu foundation and later hardened migrations.
alter table public.company_settings
  add column if not exists print_language text not null default 'both';
alter table public.company_settings
  drop constraint if exists company_settings_print_language_check;
alter table public.company_settings
  add constraint company_settings_print_language_check
  check (print_language in ('english','urdu','both'));
create or replace function public.backfill_company_urdu_names()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_count integer := 0;
  v_total integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_company is null then raise exception 'No active company selected'; end if;

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
$$;
revoke all on function public.backfill_company_urdu_names() from public, anon;
grant execute on function public.backfill_company_urdu_names() to authenticated;
