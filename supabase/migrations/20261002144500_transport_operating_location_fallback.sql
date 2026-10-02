-- Resolve the active operating location deterministically for the active workspace.
-- Preserve explicit lock and membership priority; owners/admins may fall back only
-- when the active business unit has exactly one active operating location.
create or replace function public.current_operating_location_id() returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
with ctx as (
 select auth.uid() uid, public.current_company_id() company_id, public.current_business_unit_id() business_unit_id
)
select coalesce(
 (select p.locked_operating_location_id
  from public.user_profiles p join public.operating_locations l on l.id=p.locked_operating_location_id cross join ctx
  where p.id=ctx.uid and l.company_id=ctx.company_id and l.business_unit_id=ctx.business_unit_id and l.is_active limit 1),
 (select m.operating_location_id
  from public.operating_location_memberships m join public.operating_locations l on l.id=m.operating_location_id cross join ctx
  where m.user_id=ctx.uid and m.company_id=ctx.company_id and m.business_unit_id=ctx.business_unit_id
    and m.is_active and l.is_active order by m.created_at limit 1),
 (select l.id
  from public.operating_locations l cross join ctx
  where l.company_id=ctx.company_id and l.business_unit_id=ctx.business_unit_id and l.is_active
    and (select count(*) from public.operating_locations x where x.company_id=ctx.company_id and x.business_unit_id=ctx.business_unit_id and x.is_active)=1
    and (public.is_platform_owner() or exists(select 1 from public.business_unit_memberships bm where bm.company_id=ctx.company_id and bm.business_unit_id=ctx.business_unit_id and bm.user_id=ctx.uid and bm.is_active and bm.role in ('company_owner','admin'))) order by l.created_at,l.id limit 1)
); $$;