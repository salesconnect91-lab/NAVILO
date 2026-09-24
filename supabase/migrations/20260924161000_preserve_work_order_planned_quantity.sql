alter table public.work_orders add column if not exists accepted_qty numeric(18,4) null check (accepted_qty>=0);

create or replace function public.complete_work_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_user_id uuid:=public.legacy_data_user_id();v_company_id uuid:=public.current_company_id();v_order public.work_orders%rowtype;v_product_type text;v_godown_name text;v_accepted numeric:=0;v_rejected numeric:=0;v_pending int:=0;
begin
 perform public.assert_module_permission('production','post');
 if v_user_id is null or v_company_id is null then raise exception 'Authentication and active company are required.'; end if;
 select * into v_order from public.work_orders where id=p_order_id and user_id=v_user_id and company_id=v_company_id and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Work order not found or access denied.'; end if;
 if v_order.status<>'in_progress' then raise exception 'Only an in-progress work order can be completed.'; end if;
 if v_order.item_id is null or coalesce(v_order.qty,0)<=0 or v_order.warehouse_id is null or v_order.godown_id is null then raise exception 'Finished product, quantity, warehouse and godown are required.'; end if;
 select type into v_product_type from public.items where id=v_order.item_id and company_id=v_company_id;
 if v_product_type is distinct from 'finished' then raise exception 'Work order product must be a finished item in the active company.'; end if;
 select name into v_godown_name from public.godowns where id=v_order.godown_id and warehouse_id=v_order.warehouse_id and company_id=v_company_id;
 if v_godown_name is null then raise exception 'Selected godown does not belong to the active company/warehouse.'; end if;
 if exists(select 1 from public.production_material_requirements where work_order_id=v_order.id and status<>'cancelled' and issued_qty<required_qty) then raise exception 'Issue all required materials before completing production.'; end if;
 if exists(select 1 from public.production_operations where work_order_id=v_order.id and status<>'completed') then raise exception 'Complete all production operations before completing the work order.'; end if;
 select count(*) into v_pending from public.quality_inspections where work_order_id=v_order.id and status not in('passed','released','failed');
 if v_pending>0 then raise exception 'Finalize all quality inspections before completing the work order.'; end if;
 select coalesce(sum(accepted_qty),0),coalesce(sum(rejected_qty),0) into v_accepted,v_rejected from public.production_outputs where work_order_id=v_order.id and output_type='finished_good';
 if v_accepted<=0 then raise exception 'QC-approved finished output is required before completion.'; end if;
 if v_accepted>v_order.qty then raise exception 'Accepted finished output exceeds planned work order quantity.'; end if;
 if exists(select 1 from public.stock_movements where company_id=v_order.company_id and business_unit_id=v_order.business_unit_id and reference='Production Output - '||v_order.order_no and item_id=v_order.item_id) then raise exception 'Production output stock has already been posted for this work order.'; end if;
 perform public.apply_stock_movement(v_order.item_id,v_order.warehouse_id,v_order.godown_id,'in',v_accepted,'Production Output - '||v_order.order_no);
 perform set_config('app.completing_work_order','1',true);
 update public.work_orders set status='completed',accepted_qty=v_accepted,end_date=coalesce(end_date,current_date) where id=v_order.id and user_id=v_user_id and company_id=v_company_id;
end $$;

create or replace function public.guard_work_order_accepted_qty() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.accepted_qty is distinct from old.accepted_qty and
     coalesce(current_setting('app.completing_work_order',true),'')<>'1' then
    raise exception 'QC accepted output is set by the work order completion process';
  end if;
  return new;
end$$;
revoke all on function public.guard_work_order_accepted_qty() from public,anon,authenticated;
create trigger guard_work_order_accepted_qty before update of accepted_qty on public.work_orders
for each row execute function public.guard_work_order_accepted_qty();
