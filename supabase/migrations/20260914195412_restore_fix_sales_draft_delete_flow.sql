create or replace function public.prevent_posted_sales_order_changes()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $function$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then if tg_op='DELETE' then return old; end if; return new; end if;
 if old.status='posted' then
  if tg_op='DELETE' then raise exception 'Posted sales invoices cannot be deleted.'; end if;
  if (to_jsonb(new)-'paid_amount'-'outstanding_amount'-'payment_status'-'updated_at'-'updated_by') is distinct from (to_jsonb(old)-'paid_amount'-'outstanding_amount'-'payment_status'-'updated_at'-'updated_by') then raise exception 'Posted sales invoices are immutable; only payment status fields may change.'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $function$;

create or replace function public.delete_draft_sales_invoice(p_order_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_order public.sales_orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 select * into v_order from public.sales_orders where id=p_order_id;
 if not found then return false; end if;
 if v_order.company_id is distinct from public.current_company_id() then raise exception 'Sales Invoice does not belong to the active company.'; end if;
 if v_order.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Sales Invoice belongs to another business unit.'; end if;
 if v_order.operating_location_id is distinct from public.current_operating_location_id() then raise exception 'Sales Invoice belongs to another branch/location.'; end if;
 if lower(coalesce(v_order.status,''))<>'draft' then raise exception 'Only draft Sales Invoices can be deleted.'; end if;
 if not public.has_module_permission(v_order.company_id,'sales','delete') then raise exception 'You do not have permission to delete Sales Invoices.'; end if;
 if exists(select 1 from public.invoice_payment_allocations x where x.sales_order_id=p_order_id) then raise exception 'Sales Invoice has payment allocations and cannot be deleted.'; end if;
 if exists(select 1 from public.return_notes x where x.sales_order_id=p_order_id) then raise exception 'Sales Invoice has return notes and cannot be deleted.'; end if;
 if exists(select 1 from public.consolidated_sales_invoices x where x.main_sales_order_id=p_order_id) then raise exception 'Sales Invoice is linked to a Consolidated Sales document and cannot be deleted.'; end if;
 if exists(select 1 from public.sales_consolidation_invoices x where x.sales_order_id=p_order_id) then raise exception 'Sales Invoice has consolidation links and cannot be deleted.'; end if;
 delete from public.sales_orders where id=p_order_id and status='draft'; return found;
end $function$;
revoke all on function public.delete_draft_sales_invoice(uuid) from public;
grant execute on function public.delete_draft_sales_invoice(uuid) to authenticated;