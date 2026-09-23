create or replace function public.delete_draft_purchase_invoice(p_order_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order public.purchase_orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 select * into v_order from public.purchase_orders where id=p_order_id;
 if not found then return false; end if;
 if v_order.company_id is distinct from public.current_company_id() then raise exception 'Purchase Invoice does not belong to the active company.'; end if;
 if v_order.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Purchase Invoice belongs to another business unit.'; end if;
 if v_order.operating_location_id is distinct from public.current_operating_location_id() then raise exception 'Purchase Invoice belongs to another branch/location.'; end if;
 if lower(coalesce(v_order.status,''))<>'draft' then raise exception 'Only draft Purchase Invoices can be deleted.'; end if;
 if not public.has_module_permission(v_order.company_id,'purchase','delete') then raise exception 'You do not have permission to delete Purchase Invoices.'; end if;
 if exists(select 1 from public.purchase_payment_allocations x where x.purchase_order_id=p_order_id) then raise exception 'Purchase Invoice has payment allocations and cannot be deleted.'; end if;
 if exists(select 1 from public.return_notes x where x.purchase_order_id=p_order_id) then raise exception 'Purchase Invoice has return notes and cannot be deleted.'; end if;
 delete from public.purchase_orders where id=p_order_id and status='draft';
 return found;
end; $$;
revoke all on function public.delete_draft_purchase_invoice(uuid) from public;
grant execute on function public.delete_draft_purchase_invoice(uuid) to authenticated;
