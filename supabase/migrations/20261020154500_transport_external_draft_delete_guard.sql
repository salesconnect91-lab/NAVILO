-- NAVILO Transport: guard external Sales draft deletion from RECORD OLD.trip_id error.
-- Before this fix, the shared trigger dereferenced OLD.trip_id even on
-- transport_external_invoice_lines, which has no trip_id column.
-- This patch only scopes existing supplier-rent DELETE conditions to their table.
-- Supplier rent business rules, draft-delete permissions and append-only guards
-- remain unchanged. No invoice, journal, rent or customer rows are updated.

CREATE OR REPLACE FUNCTION public.transport_financial_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 -- Only Trip Supplier Rent has trip_id: protect RECORD OLD access on other tables.
 if tg_table_name='transport_trip_supplier_rents' then
  if tg_op='DELETE' and exists(select 1 from public.transport_historical_mapping_gate g join public.transport_historical_operational_mapping m on m.trip_id=g.trip_id where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.trip_id=old.trip_id and m.company_owned and m.company_id=public.current_company_id() and m.business_unit_id=public.current_business_unit_id() and m.archived_supplier_rent=to_jsonb(old)) and not exists(select 1 from public.transport_supplier_document_rents where rent_id=old.id) then return old;end if;
  if tg_op='DELETE'
 and exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=old.trip_id and action='trip_delete')
 and not exists(select 1 from public.transport_supplier_document_rents where rent_id=old.id) then return old; end if;
 end if; -- end trip supplier rent isolation
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 if tg_table_name='transport_external_invoice_lines' then if tg_op='DELETE' and public.sales_draft_delete_gate_allows(old.sales_order_id,old.company_id,old.business_unit_id) then return old;end if;end if;
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
end $function$;
