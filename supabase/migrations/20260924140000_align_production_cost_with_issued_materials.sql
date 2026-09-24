create or replace function public.apply_work_order_inventory_cost(p_order_id uuid)
returns numeric language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_user_id uuid:=public.legacy_data_user_id();v_company_id uuid:=public.current_company_id();v_unit_id uuid:=public.current_business_unit_id();v_order public.work_orders%rowtype;v_consumed_cost numeric:=0;v_unit_cost numeric:=0;v_current numeric:=0;v_old numeric:=0;r record;
begin
 perform public.assert_module_permission('production','post');
 if v_user_id is null or v_company_id is null or v_unit_id is null then raise exception 'Authentication, active company and business unit are required.'; end if;
 select * into v_order from public.work_orders where id=p_order_id and user_id=v_user_id and company_id=v_company_id and business_unit_id=v_unit_id;
 if not found then raise exception 'Work Order not found in active business unit.'; end if;
 if v_order.status<>'completed' then raise exception 'Work Order must be completed before inventory costing.'; end if;
 if v_order.item_id is null or coalesce(v_order.qty,0)<=0 then raise exception 'Finished item and production quantity are required.'; end if;
 for r in select distinct item_id from public.production_material_requirements where work_order_id=v_order.id and company_id=v_company_id and business_unit_id=v_unit_id and issued_qty>0 union select v_order.item_id loop perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':'||v_unit_id::text||':cost:'||r.item_id::text,0)); end loop;
 select coalesce(sum(pmr.issued_qty*public.get_inventory_avg_cost(pmr.item_id)),0) into v_consumed_cost from public.production_material_requirements pmr where pmr.work_order_id=v_order.id and pmr.company_id=v_company_id and pmr.business_unit_id=v_unit_id and pmr.status<>'cancelled';
 if v_consumed_cost<0 then raise exception 'Invalid production consumption value.'; end if;
 v_unit_cost:=v_consumed_cost/v_order.qty;
 select coalesce(sum(ws.quantity),0) into v_current from public.warehouse_stock ws where ws.user_id=v_user_id and ws.company_id=v_company_id and ws.business_unit_id=v_unit_id and ws.item_id=v_order.item_id;
 v_old:=greatest(v_current-v_order.qty,0);
 perform public.apply_inventory_cost_in(v_order.item_id,v_old,v_order.qty,v_unit_cost);
 return round(v_unit_cost,6);
end $$;