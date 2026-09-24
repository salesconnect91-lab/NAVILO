alter table public.stock_movements
  add column if not exists reason text,
  add column if not exists remarks text,
  add column if not exists unit_cost numeric,
  add column if not exists source_type text,
  add column if not exists source_id uuid;

create or replace function public.apply_stock_movement(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_godown_id uuid,
  p_type text,
  p_qty numeric,
  p_reference text default null::text
)
returns numeric
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
 v_user_id uuid:=public.legacy_data_user_id(); v_company_id uuid:=public.current_company_id(); v_unit_id uuid:=public.current_business_unit_id();
 v_stock_id uuid; v_godown_name text; v_current numeric:=0; v_new numeric;
begin
 perform public.assert_module_permission('inventory','edit');
 if v_user_id is null or v_company_id is null or v_unit_id is null then raise exception 'Authentication, active company and business unit are required.'; end if;
 if p_item_id is null or p_warehouse_id is null or p_godown_id is null then raise exception 'Item, warehouse and godown are required.'; end if;
 if p_type <> 'adjust' then raise exception 'Direct manual Stock IN/OUT is disabled. Use Purchase/GRN, Sales/Delivery, Returns, Production, Transfer, Opening Stock, or an authorized Stock Adjustment.'; end if;
 if p_qty is null or p_qty < 0 then raise exception 'New physical quantity cannot be negative.'; end if;
 if nullif(btrim(p_reference),'') is null then raise exception 'Adjustment reason/reference is required.'; end if;
 if not exists(select 1 from public.items where id=p_item_id and company_id=v_company_id) then raise exception 'Selected item does not belong to active company.'; end if;
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and company_id=v_company_id) then raise exception 'Selected warehouse does not belong to active company.'; end if;
 select name into v_godown_name from public.godowns where id=p_godown_id and warehouse_id=p_warehouse_id and company_id=v_company_id;
 if v_godown_name is null then raise exception 'Selected godown does not belong to active company/warehouse.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':'||v_unit_id::text||':'||p_item_id::text||':'||p_warehouse_id::text||':'||p_godown_id::text,0));
 select id,coalesce(quantity,0) into v_stock_id,v_current from public.warehouse_stock where user_id=v_user_id and company_id=v_company_id and business_unit_id=v_unit_id and item_id=p_item_id and warehouse_id=p_warehouse_id and godown_id=p_godown_id limit 1 for update;
 v_current:=coalesce(v_current,0); v_new:=p_qty;
 if v_stock_id is null then insert into public.warehouse_stock(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,quantity,updated_at) values(v_user_id,v_company_id,v_unit_id,p_item_id,p_warehouse_id,p_godown_id,v_godown_name,v_new,now());
 else update public.warehouse_stock set quantity=v_new,godown=v_godown_name,updated_at=now() where id=v_stock_id and business_unit_id=v_unit_id; end if;
 insert into public.stock_movements(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,type,qty,reference,reason,remarks,source_type,created_by) values(v_user_id,v_company_id,v_unit_id,p_item_id,p_warehouse_id,p_godown_id,v_godown_name,'adjust',p_qty,btrim(p_reference),btrim(p_reference),btrim(p_reference),'manual_adjustment',auth.uid());
 return v_new;
end;
$function$;
