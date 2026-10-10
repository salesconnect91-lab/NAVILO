-- Explicit, audited draft-only Sales invoice removal, including unposted Transport imports.
-- Existing posted journal/transport evidence remains immutable.
create table if not exists public.sales_draft_delete_gate (
 transaction_id bigint not null,
 sales_order_id uuid not null,
 company_id uuid not null,
 business_unit_id uuid not null,
 requested_by uuid not null,
 primary key(transaction_id,sales_order_id)
);
revoke all on public.sales_draft_delete_gate from public,anon,authenticated;
alter table public.sales_draft_delete_gate enable row level security;

create or replace function public.sales_draft_delete_gate_allows(p_order_id uuid,p_company_id uuid,p_business_unit_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp'
as $$
 select auth.uid() is not null
   and p_company_id=public.current_company_id()
   and p_business_unit_id=public.current_business_unit_id()
   and public.has_module_permission(p_company_id,'sales','delete')
   and exists (
     select 1 from public.sales_draft_delete_gate g
     join public.sales_orders o on o.id=g.sales_order_id
     where g.transaction_id=txid_current() and g.sales_order_id=p_order_id
       and g.company_id=p_company_id and g.business_unit_id=p_business_unit_id
       and g.requested_by=auth.uid()
       and o.company_id=p_company_id and o.business_unit_id=p_business_unit_id
       and o.operating_location_id=public.current_operating_location_id()
       and o.status='draft' and o.posted_at is null
   );
$$;
revoke all on function public.sales_draft_delete_gate_allows(uuid,uuid,uuid) from public,anon,authenticated;

-- Preserve the existing append-only guard; add only a gated, unposted draft exception.
create or replace function public.guard_service_document_line()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare o record;v_module text:=case when tg_table_name='sales_service_lines' then 'sales' else 'purchase' end;
begin
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
end $$;

create or replace function public.transport_financial_append_only()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 if tg_table_name='transport_external_invoice_lines' and tg_op='DELETE'
   and public.sales_draft_delete_gate_allows(old.sales_order_id,old.company_id,old.business_unit_id) then
   return old;
 end if;
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

create or replace function public.delete_draft_sales_invoice(p_order_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_order public.sales_orders%rowtype;v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'Authentication required.';end if;
 if p_order_id is null then raise exception 'Sales invoice ID is required.';end if;
 select * into v_order from public.sales_orders where id=p_order_id for update;
 if not found then return false;end if;
 if v_order.company_id is distinct from public.current_company_id() then raise exception 'Sales Invoice does not belong to the active company.';end if;
 if v_order.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Sales Invoice belongs to another business unit.';end if;
 if v_order.operating_location_id is distinct from public.current_operating_location_id() then raise exception 'Sales Invoice belongs to another branch/location.';end if;
 if v_order.status<>'draft' or v_order.posted_at is not null then raise exception 'Only unposted draft Sales Invoices can be deleted.';end if;
 if not public.has_module_permission(v_order.company_id,'sales','delete') then raise exception 'Sales Delete permission is required.';end if;
 if coalesce(v_order.paid_amount,0)<>0 then raise exception 'Invoice has received payments and cannot be deleted.';end if;
 if exists(select 1 from public.invoice_payment_allocations x where x.sales_order_id=p_order_id)
    or exists(select 1 from public.return_notes x where x.sales_order_id=p_order_id)
    or exists(select 1 from public.consolidated_sales_invoices x where x.main_sales_order_id=p_order_id)
    or exists(select 1 from public.sales_consolidation_invoices x where x.sales_order_id=p_order_id)
    or exists(select 1 from public.sales_order_hawala_invoices x where x.sales_order_id=p_order_id)
    or exists(select 1 from public.transport_customer_documents x where x.sales_order_id=p_order_id)
    or exists(select 1 from public.transport_trips x where x.sales_order_id=p_order_id)
    or exists(select 1 from public.gate_passes x where x.sales_order_id=p_order_id)
    or exists(select 1 from public.transport_external_note_requests x where x.original_order_id=p_order_id or x.debit_order_id=p_order_id)
    or exists(select 1 from public.transport_external_credit_allocations a join public.transport_external_invoice_lines l on a.external_line_id=l.id where l.sales_order_id=p_order_id)
    or exists(select 1 from public.journal_entries x where x.source_document_id=p_order_id)
 then raise exception 'Invoice has linked financial, transport, trip or correction evidence and cannot be deleted.';end if;
 insert into public.sales_draft_delete_gate(transaction_id,sales_order_id,company_id,business_unit_id,requested_by)
 values(txid_current(),p_order_id,v_order.company_id,v_order.business_unit_id,v_user);
 delete from public.transport_external_invoice_lines where sales_order_id=p_order_id;
 delete from public.sales_service_lines where order_id=p_order_id;
 delete from public.sales_orders where id=p_order_id and status='draft';
 if not found then raise exception 'Draft changed during delete; nothing was deleted.';end if;
 delete from public.sales_draft_delete_gate where transaction_id=txid_current() and sales_order_id=p_order_id;
 return true;
end $$;
revoke all on function public.delete_draft_sales_invoice(uuid) from public,anon;
grant execute on function public.delete_draft_sales_invoice(uuid) to authenticated;

notify pgrst,'reload schema';
