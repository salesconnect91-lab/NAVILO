create or replace function public.consume_work_order_materials(p_work_order_id uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare w public.work_orders%rowtype; r record; v_count int:=0; v_qty numeric; v_godown uuid;
begin
 perform public.assert_module_permission('production','post');
 select * into w from public.work_orders where id=p_work_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Work order not found in active business unit.'; end if;
 if w.status<>'in_progress' then raise exception 'Materials can only be issued to an in-progress work order.'; end if;
 if w.warehouse_id is null or w.godown_id is null then raise exception 'Work order warehouse and godown are required.'; end if;
 for r in select * from public.production_material_requirements where work_order_id=w.id and company_id=w.company_id and business_unit_id=w.business_unit_id and status<>'cancelled' order by item_id for update loop
   v_qty:=greatest(r.required_qty-r.issued_qty,0); if v_qty=0 then continue; end if;
   if r.reserved_qty<r.required_qty then raise exception 'Reserve all required material before issue. Item %.',r.item_id; end if;
   select sr.godown_id into v_godown from public.stock_reservations sr where sr.company_id=w.company_id and sr.business_unit_id=w.business_unit_id and sr.source_type='work_order' and sr.source_id=w.id and sr.item_id=r.item_id and sr.status in('active','part_consumed') order by sr.created_at limit 1 for update;
   if v_godown is null then raise exception 'Active stock reservation is missing for item %.',r.item_id; end if;
   perform public.apply_stock_movement(r.item_id,w.warehouse_id,v_godown,'out',v_qty,'Production Material Issue - '||w.order_no);
   update public.stock_reservations set consumed_qty=least(reserved_qty,consumed_qty+v_qty),status=case when consumed_qty+v_qty>=reserved_qty then 'consumed' else 'part_consumed' end,updated_at=now() where company_id=w.company_id and business_unit_id=w.business_unit_id and source_type='work_order' and source_id=w.id and item_id=r.item_id and status in('active','part_consumed');
   update public.production_material_requirements set issued_qty=issued_qty+v_qty,status=case when issued_qty+v_qty>=required_qty then 'issued' else 'reserved' end,updated_at=now() where id=r.id;
   v_count:=v_count+1;
 end loop;
 return jsonb_build_object('success',true,'requirements_issued',v_count,'work_order_id',w.id);
end $$;
revoke all on function public.consume_work_order_materials(uuid) from public,anon;
grant execute on function public.consume_work_order_materials(uuid) to authenticated;