-- NAVILO Phase 2 ACC-005
-- Source document branch/location must equal active branch/location.
-- Local rehearsal first; production remains untouched.

create or replace function public.assert_source_operating_location(
  p_company_id uuid,
  p_business_unit_id uuid,
  p_source_operating_location_id uuid
)
returns void
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_active uuid := public.current_operating_location_id();
begin
  if p_company_id is distinct from public.current_company_id()
     or p_business_unit_id is distinct from public.current_business_unit_id()
  then
    raise exception 'Source document is outside the active company/business unit.';
  end if;

  if v_active is null then
    raise exception 'Active branch/location is required for posting.';
  end if;

  if p_source_operating_location_id is null then
    raise exception 'Source document branch/location is missing.';
  end if;

  if p_source_operating_location_id is distinct from v_active then
    raise exception 'Cross-branch posting denied. Switch to the source document branch.';
  end if;
end;
$$;

revoke all on function public.assert_source_operating_location(uuid,uuid,uuid)
from public,anon;

grant execute on function public.assert_source_operating_location(uuid,uuid,uuid)
to authenticated;

-- Enforce on posting transition as a second defensive boundary.
create or replace function public.guard_sales_order_posting_location()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
begin
  if new.status='posted' and old.status is distinct from 'posted' then
    perform public.assert_source_operating_location(
      new.company_id,new.business_unit_id,new.operating_location_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists zz_guard_sales_order_posting_location
on public.sales_orders;

create trigger zz_guard_sales_order_posting_location
before update of status on public.sales_orders
for each row execute function public.guard_sales_order_posting_location();

create or replace function public.guard_purchase_order_posting_location()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
begin
  if new.status='posted' and old.status is distinct from 'posted' then
    perform public.assert_source_operating_location(
      new.company_id,new.business_unit_id,new.operating_location_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists zz_guard_purchase_order_posting_location
on public.purchase_orders;

create trigger zz_guard_purchase_order_posting_location
before update of status on public.purchase_orders
for each row execute function public.guard_purchase_order_posting_location();
