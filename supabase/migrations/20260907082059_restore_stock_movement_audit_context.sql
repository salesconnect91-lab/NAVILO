create or replace function public.stamp_stock_movement_audit_context() returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_current numeric;
begin
 if new.source_type is null then new.source_type:='source_document'; end if;
 if new.previous_qty is null or new.resulting_qty is null then
   select coalesce(quantity,0) into v_current from public.warehouse_stock where company_id=coalesce(new.company_id,public.current_company_id()) and business_unit_id=coalesce(new.business_unit_id,public.current_business_unit_id()) and item_id=new.item_id and warehouse_id=new.warehouse_id and godown_id=new.godown_id limit 1;
   if new.type in('out','purchase_return') then new.resulting_qty:=v_current;new.previous_qty:=v_current+coalesce(new.qty,0);
   elsif new.type in('in','sale_return') then new.resulting_qty:=v_current;new.previous_qty:=greatest(v_current-coalesce(new.qty,0),0); end if;
 end if; return new;
end $$;
drop trigger if exists trg_stamp_stock_movement_audit_context on public.stock_movements;
create trigger trg_stamp_stock_movement_audit_context before insert on public.stock_movements for each row execute function public.stamp_stock_movement_audit_context();