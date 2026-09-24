create or replace function public.normalize_direct_manual_journal_number()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(current_setting('app.maintenance_reset', true),'0')='1' then return new; end if;
  if coalesce(new.status,'draft')='draft'
     and coalesce(new.trans_type,'')=''
     and coalesce(new.entry_no,'') ~ '^JE-[0-9]{8}$' then
    perform public.assert_module_permission('accounting','create');
    new.entry_no := public.next_document_number('manual_journal','JE-');
    new.trans_type := 'Manual Journal';
  end if;
  return new;
end;
$function$;

drop trigger if exists aa_normalize_manual_journal_number on public.journal_entries;
create trigger aa_normalize_manual_journal_number
before insert on public.journal_entries
for each row execute function public.normalize_direct_manual_journal_number();

