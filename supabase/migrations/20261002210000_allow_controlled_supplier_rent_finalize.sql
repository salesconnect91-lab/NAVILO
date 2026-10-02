-- Allow only the existing controlled supplier-rent finalize gate to mutate pending evidence.
-- Direct UPDATE/DELETE remains immutable.
create or replace function public.transport_financial_append_only()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if tg_table_name = 'transport_trip_supplier_rents'
     and tg_op = 'UPDATE'
     and exists (
       select 1
       from public.transport_action_gate g
       where g.transaction_id = txid_current()
         and g.trip_id = old.trip_id
         and g.action = 'supplier_rent_finalize'
     )
     and new.id = old.id
     and new.company_id is not distinct from old.company_id
     and new.business_unit_id is not distinct from old.business_unit_id
     and new.trip_id is not distinct from old.trip_id
     and new.supplier_id is not distinct from old.supplier_id
     and old.state = 'pending'
     and new.state = 'finalized'
  then
    return new;
  end if;
  raise exception 'Transport financial evidence is immutable';
end
$$;