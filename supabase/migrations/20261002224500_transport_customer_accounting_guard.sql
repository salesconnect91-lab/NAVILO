-- Protect customer accounting identity on Transport Trips.
create or replace function public.transport_trip_customer_accounting_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_customer_name text;
begin
  if new.customer_id is not distinct from old.customer_id then return new; end if;

  -- A canonical Transport customer document fixes the accounting party.
  if old.sales_order_id is not null
     or exists (
       select 1
       from public.transport_customer_document_trips l
       where l.trip_id=old.id and not l.is_adjustment
     ) then
    raise exception 'Customer cannot be changed because this Trip has posted customer financial documents. Use financial correction/reallocation.';
  end if;

  if new.customer_id is null then
    raise exception 'Customer is required';
  end if;

  select c.name into v_customer_name
  from public.customers c
  where c.id=new.customer_id and c.company_id=new.company_id;

  if v_customer_name is null then
    raise exception 'New customer is missing or outside the Trip company';
  end if;

  -- Before posting there is no AR evidence to transfer; keep the Trip snapshot aligned.
  new.customer_name_snapshot:=v_customer_name;
  return new;
end
$function$;

drop trigger if exists transport_trip_customer_accounting_guard on public.transport_trips;
create trigger transport_trip_customer_accounting_guard
before update of customer_id on public.transport_trips
for each row execute function public.transport_trip_customer_accounting_guard();

comment on function public.transport_trip_customer_accounting_guard() is
'Allows customer changes only before canonical customer billing. Posted customer identity remains immutable accounting evidence.';
