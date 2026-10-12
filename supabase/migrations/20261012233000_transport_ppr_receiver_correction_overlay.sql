-- Auditable name-only correction overlay; immutable historical evidence stays untouched.
create table if not exists public.transport_ppr_receiver_corrections (
 trip_id uuid primary key references public.transport_trips(id) on delete restrict,
 company_id uuid not null references public.companies(id),
 business_unit_id uuid not null,
 original_name text not null,
 corrected_name text not null,
 correction_reason text not null,
 corrected_at timestamptz not null default now()
);
alter table public.transport_ppr_receiver_corrections enable row level security;
revoke all on public.transport_ppr_receiver_corrections from anon,authenticated;
insert into public.transport_ppr_receiver_corrections(trip_id,company_id,business_unit_id,original_name,corrected_name,correction_reason)
select t.id,t.company_id,t.business_unit_id,t.ppr_received_by_name,'AWAIS SIDDIQUI','User-confirmed historical SELF receiver alias'
from public.transport_trips t join public.transport_historical_operational_mapping h on h.trip_id=t.id and h.company_id=t.company_id
where t.company_id='c611adca-fd2f-4cc1-b379-3aed22924f65'::uuid and t.ppr_status='received'
and upper(btrim(t.ppr_received_by_name))='SELF' and upper(btrim(h.paper_receiver))='SELF'
on conflict(trip_id) do nothing;
create or replace function public.transport_ppr_corrected_receiver(p_trip_ids uuid[])
returns table(trip_id uuid,corrected_name text)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.trip_id,c.corrected_name from public.transport_ppr_receiver_corrections c
 where c.trip_id=any(p_trip_ids)
 and c.company_id=public.current_company_id()
 and c.business_unit_id=public.current_business_unit_id()
 and public.has_transport_action_permission(c.company_id,'trip_view')
$$;
revoke all on function public.transport_ppr_corrected_receiver(uuid[]) from public;
grant execute on function public.transport_ppr_corrected_receiver(uuid[]) to authenticated;
