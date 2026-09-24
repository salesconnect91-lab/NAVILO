-- Keep the earlier direct-status posting safeguard without modifying an
-- already-posted weighted-average COGS journal.
create or replace function public.sync_sales_inventory_cogs()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status is distinct from 'posted' and new.status='posted' and
     not exists (
       select 1 from public.journal_entries je
       where je.user_id=new.user_id and je.company_id=new.company_id
         and je.business_unit_id=new.business_unit_id
         and je.entry_no=new.order_no and je.status='posted'
     ) then
    raise exception 'Sales Invoice must be posted through the sales posting process.';
  end if;
  return new;
end $$;
create trigger trg_sync_sales_inventory_cogs
after update of status on public.sales_orders
for each row when (old.status is distinct from new.status and new.status='posted')
execute function public.sync_sales_inventory_cogs();
revoke execute on function public.sync_sales_inventory_cogs() from public,anon,authenticated;
