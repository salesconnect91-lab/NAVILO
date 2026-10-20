-- PENDING EXPLICIT DATABASE APPROVAL. Do not apply or auto-run.
-- Root cause: the shared immutability trigger on transport_external_invoice_lines
-- evaluates old.trip_id inside the supplier-rent exception, but external invoices
-- do not have a trip_id column. A draft-delete RPC fails with 42703.
-- The patch places old.trip_id references ONLY inside a supplier-rent table branch.
-- Scope: one shared trigger function; no changes to posted records, journals or trips.
-- Keep this in /maintenance/pending; not in automatically applied migrations.

CREATE OR REPLACE FUNCTION public.transport_financial_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 -- Check the table before reading supplier-rent trip columns.
 if tg_op='DELETE' and tg_table_name='transport_trip_supplier_rents' then
  if exists(select 1 from public.transport_historical_mapping_gate g join public.transport_historical_operational_mapping m on m.trip_id=g.trip_id where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.trip_id=old.trip_id and m.company_owned and m.company_id=public.current_company_id() and m.business_unit_id=public.current_business_unit_id() and m.archived_supplier_rent=to_jsonb(old)) and not exists(select 1 from public.transport_supplier_document_rents where rent_id=old.id) then return old;end if;
 if exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=old.trip_id and action='trip_delete')
 and not exists(select 1 from public.transport_supplier_document_rents where rent_id=old.id) then return old; end if;
 end if; -- end supplier-rent DELETE gate
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 if tg_table_name='transport_external_invoice_lines' then if tg_op='DELETE' and public.sales_draft_delete_gate_allows(old.sales_order_id,old.company_id,old.business_unit_id) then return old;end if;end if;
 if tg_table_name='transport_trip_supplier_rents' then
  if tg_op='UPDATE' then
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
  end if; -- UPDATE
 end if; -- end supplier-rent UPDATE gate
 raise exception 'Transport financial evidence is immutable';
end $function$
