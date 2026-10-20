-- NAVILO Transport external Draft Sales invoice delete regression fix.
-- Apply after 20261020154500_transport_external_draft_delete_guard.sql.
-- Only trigger functions are replaced. No invoices, rentals, journals,
-- financial evidence, or other tenant data are mutated by this migration.
--
-- 1. The shared financial evidence trigger must never dereference OLD.trip_id
--    for external invoice lines. Only transport_trip_supplier_rents has trip_id.
-- 2. Service-line DELETE must be handled before accessing NEW.* because NEW
--    is undefined in a DELETE trigger. Keep the existing transaction-scoped
--    delete gate and all posted financial evidence immutable.
-- 3. Maintenance override remains transaction-locally available as before.
--
CREATE OR REPLACE FUNCTION public.transport_financial_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 -- Draft external-invoice DELETE rows have no trip_id. Never evaluate supplier-rent
 -- OLD.trip_id checks on any other table; PostgreSQL boolean expression evaluation
 -- does not guarantee safe short-circuiting of composite records.
 if tg_table_name='transport_external_invoice_lines' then
   if tg_op='DELETE' and public.sales_draft_delete_gate_allows(old.sales_order_id,old.company_id,old.business_unit_id) then
     return old;
   end if;
   raise exception 'Transport financial evidence is immutable';
 end if;
 if tg_table_name='transport_trip_supplier_rents' then
 if tg_op='DELETE' and exists(select 1 from public.transport_historical_mapping_gate g join public.transport_historical_operational_mapping m on m.trip_id=g.trip_id where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.trip_id=old.trip_id and m.company_owned and m.company_id=public.current_company_id() and m.business_unit_id=public.current_business_unit_id() and m.archived_supplier_rent=to_jsonb(old)) and not exists(select 1 from public.transport_supplier_document_rents where rent_id=old.id) then return old;end if;
 if tg_op='DELETE'
 and exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=old.trip_id and action='trip_delete')
 and not exists(select 1 from public.transport_supplier_document_rents where rent_id=old.id) then return old; end if;
 end if; -- end of supplier-rent-only OLD.trip_id handling
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

CREATE OR REPLACE FUNCTION public.guard_service_document_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare o record;v_module text:=case when tg_table_name='sales_service_lines' then 'sales' else 'purchase' end;
begin
 -- Explicit DELETE branch: NEW is not available on DELETE. The old form
 -- combined tg_op <> 'DELETE' with NEW.field SQL expressions that can be
 -- evaluated out of order, blocking otherwise-authorized draft cleanup.
 if tg_op='DELETE' then
  if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return old; end if;
  if tg_table_name='sales_service_lines'
     and public.sales_draft_delete_gate_allows(old.order_id,old.company_id,old.business_unit_id) then
    return old;
  end if;
  raise exception 'Service line history is append-only';
 end if;
 if tg_op<>'DELETE' and public.transport_register_conversion_allowed(new.order_id,case when tg_table_name='sales_service_lines' then 'customer' else 'supplier' end) then
 if new.source_module<>'historical_register' or not exists(select 1 from public.transport_register_invoice_conversion_lines l join public.transport_register_invoice_conversions v on v.document_id=l.document_id where v.order_id=new.order_id and l.trip_id=new.source_id and l.net=new.amount and l.vat=new.historical_vat_amount and l.tax_percent=new.tax_percent) then raise exception 'Historical service line must exactly match approved source allocation';end if;return new;end if;
 if tg_table_name in('sales_service_lines','purchase_service_lines') then if tg_op<>'DELETE' and new.historical_vat_amount is not null then raise exception 'Historical VAT snapshot requires controlled conversion';end if;end if;

 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
   if tg_table_name='sales_service_lines'
     and public.sales_draft_delete_gate_allows(old.order_id,old.company_id,old.business_unit_id) then
     return old;
   end if;
   raise exception 'Service line history is append-only';
 end if;
 if new.company_id is distinct from public.current_company_id() or new.business_unit_id is distinct from public.current_business_unit_id() or not public.has_module_permission(new.company_id,v_module,case when tg_op='INSERT' then 'create' else 'edit' end) then raise exception 'Service line permission or tenant mismatch';end if;
 if tg_table_name='sales_service_lines' then select company_id,business_unit_id,status,document_kind,invoice_type,tax_percent into o from public.sales_orders where id=new.order_id;else select company_id,business_unit_id,status,document_kind,invoice_type,tax_percent into o from public.purchase_orders where id=new.order_id;if not exists(select 1 from public.chart_of_accounts a where a.id=new.cost_account_id and a.company_id=new.company_id and a.type='expense' and a.is_active and not a.is_group) then raise exception 'Active company service expense account required';end if;end if;
 if o.company_id is distinct from new.company_id or o.business_unit_id is distinct from new.business_unit_id or o.document_kind<>'service' or o.status='posted' or new.tax_percent is distinct from(case when o.invoice_type='Tax Invoice' then o.tax_percent else 0 end) then raise exception 'Draft service document and tax snapshot required';end if;
 if tg_op='UPDATE' and(to_jsonb(new)-'description'-'amount'-'tax_percent'-'cost_account_id') is distinct from(to_jsonb(old)-'description'-'amount'-'tax_percent'-'cost_account_id') then raise exception 'Service line identity is immutable';end if;
 if tg_op='INSERT' then new.created_by:=auth.uid();end if;
 return new;
end $function$;
