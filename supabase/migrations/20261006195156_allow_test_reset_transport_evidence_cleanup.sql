-- Synced from verified production migration 20261006195156 (allow_test_reset_transport_evidence_cleanup).
create or replace function public.transport_financial_append_only()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 if tg_table_name='transport_trip_supplier_rents' and tg_op='UPDATE' then
  if exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action='supplier_rent_finalize')
   and new.id=old.id and new.company_id is not distinct from old.company_id and new.business_unit_id is not distinct from old.business_unit_id
   and new.trip_id is not distinct from old.trip_id and new.supplier_id is not distinct from old.supplier_id
   and old.state in('pending','finalized') and new.state='finalized'
   and not exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=old.id and not l.is_adjustment)
  then return new; end if;
  if exists(select 1 from public.transport_action_gate g where g.transaction_id=txid_current() and g.trip_id=old.trip_id and g.action='assignment_replace')
   and new.id=old.id and new.company_id is not distinct from old.company_id and new.business_unit_id is not distinct from old.business_unit_id
   and new.trip_id is not distinct from old.trip_id and new.amount is not distinct from old.amount and new.state is not distinct from old.state
   and new.finalized_amount_snapshot is not distinct from old.finalized_amount_snapshot
   and not exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=old.id and not l.is_adjustment)
  then return new; end if;
 end if;
 raise exception 'Transport financial evidence is immutable';
end $$;
