create or replace function public.enforce_journal_operating_location_write_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location uuid := public.current_operating_location_id();
  v_row_location uuid;
begin
  if coalesce(current_setting('app.maintenance_reset', true),'0') = '1' then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if v_location is null then
    raise exception 'No active branch/location selected.';
  end if;

  v_row_location := case when tg_op='DELETE' then old.operating_location_id else new.operating_location_id end;

  if v_row_location is null then
    raise exception 'Journal entry branch/location is required.';
  end if;

  if v_row_location is distinct from v_location then
    raise exception 'Journal entry belongs to another branch/location.';
  end if;

  if tg_op <> 'DELETE' and new.reversal_of_entry_id is not null then
    if not exists (
      select 1
      from public.journal_entries original
      where original.id = new.reversal_of_entry_id
        and original.company_id = new.company_id
        and original.business_unit_id = new.business_unit_id
        and original.operating_location_id = v_location
    ) then
      raise exception 'Reversal journal must belong to the same active branch/location as the original journal.';
    end if;
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists zzz_journal_operating_location_scope on public.journal_entries;
create trigger zzz_journal_operating_location_scope
before insert or update or delete on public.journal_entries
for each row execute function public.enforce_journal_operating_location_write_scope();

create or replace function public.enforce_journal_line_operating_location_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location uuid := public.current_operating_location_id();
  v_row_location uuid;
  v_entry_location uuid;
begin
  if coalesce(current_setting('app.maintenance_reset', true),'0') = '1' then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if v_location is null then
    raise exception 'No active branch/location selected.';
  end if;

  v_row_location := case when tg_op='DELETE' then old.operating_location_id else new.operating_location_id end;
  if v_row_location is null then
    raise exception 'Journal line branch/location is required.';
  end if;
  if v_row_location is distinct from v_location then
    raise exception 'Journal line belongs to another branch/location.';
  end if;

  select je.operating_location_id into v_entry_location
  from public.journal_entries je
  where je.id = case when tg_op='DELETE' then old.entry_id else new.entry_id end;

  if v_entry_location is null or v_entry_location is distinct from v_row_location then
    raise exception 'Journal line branch/location must match its journal entry.';
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists zzz_journal_line_operating_location_scope on public.journal_lines;
create trigger zzz_journal_line_operating_location_scope
before insert or update or delete on public.journal_lines
for each row execute function public.enforce_journal_line_operating_location_scope();
