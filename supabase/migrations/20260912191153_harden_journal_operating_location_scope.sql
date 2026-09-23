alter table public.ledgers add column if not exists operating_location_id uuid references public.operating_locations(id);

set local app.maintenance_reset = '1';

update public.journal_entries je
set operating_location_id = x.location_id
from (
  select b.id as business_unit_id, (array_agg(l.id order by l.created_at))[1] as location_id
  from public.business_units b
  join public.operating_locations l on l.company_id=b.company_id and l.business_unit_id=b.id and l.is_active
  group by b.id
  having count(*)=1
) x
where je.business_unit_id=x.business_unit_id
  and je.operating_location_id is null;

update public.journal_lines jl
set operating_location_id = je.operating_location_id
from public.journal_entries je
where je.id=jl.entry_id
  and jl.operating_location_id is null
  and je.operating_location_id is not null;

update public.ledgers l
set operating_location_id = je.operating_location_id
from public.journal_entries je
where je.id=l.journal_entry_id
  and l.operating_location_id is null
  and je.operating_location_id is not null;

reset app.maintenance_reset;

drop trigger if exists zz_operating_location_scope on public.journal_entries;
create trigger zz_operating_location_scope
before insert or update on public.journal_entries
for each row execute function public.stamp_operating_location_context();

drop trigger if exists zz_operating_location_scope on public.journal_lines;
create trigger zz_operating_location_scope
before insert or update on public.journal_lines
for each row execute function public.stamp_operating_location_context();

drop trigger if exists zz_operating_location_scope on public.ledgers;
create trigger zz_operating_location_scope
before insert or update on public.ledgers
for each row execute function public.stamp_operating_location_context();

create index if not exists idx_journal_entries_operating_location on public.journal_entries(operating_location_id);
create index if not exists idx_journal_lines_operating_location on public.journal_lines(operating_location_id);
create index if not exists idx_ledgers_operating_location on public.ledgers(operating_location_id);

drop policy if exists journal_entries_operating_location_scope on public.journal_entries;
create policy journal_entries_operating_location_scope on public.journal_entries
as restrictive for all to authenticated
using (
  (public.current_operating_location_id() is null and operating_location_id is null)
  or operating_location_id = public.current_operating_location_id()
)
with check (
  (public.current_operating_location_id() is null and operating_location_id is null)
  or operating_location_id = public.current_operating_location_id()
);

drop policy if exists journal_lines_operating_location_scope on public.journal_lines;
create policy journal_lines_operating_location_scope on public.journal_lines
as restrictive for all to authenticated
using (
  (public.current_operating_location_id() is null and operating_location_id is null)
  or operating_location_id = public.current_operating_location_id()
)
with check (
  (public.current_operating_location_id() is null and operating_location_id is null)
  or operating_location_id = public.current_operating_location_id()
);

drop policy if exists ledgers_operating_location_scope on public.ledgers;
create policy ledgers_operating_location_scope on public.ledgers
as restrictive for all to authenticated
using (
  (public.current_operating_location_id() is null and operating_location_id is null)
  or operating_location_id = public.current_operating_location_id()
)
with check (
  (public.current_operating_location_id() is null and operating_location_id is null)
  or operating_location_id = public.current_operating_location_id()
);
