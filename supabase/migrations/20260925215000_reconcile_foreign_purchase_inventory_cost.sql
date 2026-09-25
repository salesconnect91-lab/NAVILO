begin;
create or replace function public.sync_purchase_inventory_cost()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid;v_bu uuid;v_current numeric;v_old numeric;v_total_item_value numeric:=0;v_landed numeric:=0;r record;v_item_alloc numeric:=0;v_direct_alloc numeric:=0;v_linked_alloc numeric:=0;v_base text;v_rate numeric:=1;
begin
 if old.status is not distinct from 'posted' or new.status is distinct from 'posted' then return new; end if; v_uid:=new.user_id;v_bu:=new.business_unit_id;
 if not exists(select 1 from public.journal_entries je where je.user_id=v_uid and je.company_id=new.company_id and je.business_unit_id=v_bu and je.entry_no='PUR-'||new.order_no) then raise exception 'Purchase Invoice must be posted through the purchase posting process.'; end if;
 select base_currency_code into v_base from public.companies where id=new.company_id;
 v_rate:=case when coalesce(nullif(new.currency_code,''),v_base)=v_base then 1 else new.exchange_rate end;
 if v_rate is null or v_rate<=0 then raise exception 'Purchase Invoice has no valid locked exchange rate for inventory costing.'; end if;
 select coalesce(sum(coalesce(qty,0)*coalesce(unit_cost,0)),0) into v_total_item_value from public.purchase_order_lines where order_id=new.id and company_id=new.company_id and business_unit_id=v_bu;
 with direct_charges(charge_key,amount) as (values ('loading',coalesce(new.loading_charge,0)),('unloading',coalesce(new.unloading_charge,0)),('cutting',coalesce(new.cutting_charge,0)),('transport',coalesce(new.transport_charge,0)),('labour',coalesce(new.labour_charge,0)),('handling',coalesce(new.handling_charge,0)),('other',coalesce(new.other_charge,0))),
 all_charges as (
  select d.charge_key,d.amount,case when d.charge_key='other' then 'expense' else coalesce(cm.purchase_treatment,'landed_cost') end treatment from direct_charges d left join public.charge_master cm on cm.company_id=new.company_id and cm.charge_key=d.charge_key and cm.applies_to in('purchase','both') and cm.is_active
  union all select c.charge_key,c.amount,case when c.charge_key='other' then 'expense' else coalesce(cm.purchase_treatment,'landed_cost') end from public.consolidated_purchase_invoice_charges c join public.purchase_order_consolidated_invoices l on l.consolidated_invoice_id=c.invoice_id left join public.charge_master cm on cm.company_id=new.company_id and cm.charge_key=c.charge_key and cm.applies_to in('purchase','both') and cm.is_active where l.purchase_order_id=new.id and l.company_id=new.company_id and l.business_unit_id=v_bu)
 select coalesce(sum(case when treatment='landed_cost' then amount else 0 end),0) into v_landed from all_charges;
 v_landed:=v_landed*v_rate;
 for r in select pol.item_id,sum(coalesce(pol.qty,0)) total_qty,sum(coalesce(pol.qty,0)*coalesce(pol.unit_cost,0)) total_val,sum(coalesce(pol.qty,0)) filter(where pol.source_consolidated_purchase_invoice_id is null) direct_qty,sum(coalesce(pol.qty,0)*coalesce(pol.unit_cost,0)) filter(where pol.source_consolidated_purchase_invoice_id is null) direct_val,sum(coalesce(pol.qty,0)*coalesce(pol.unit_cost,0)) filter(where pol.source_consolidated_purchase_invoice_id is not null) linked_val from public.purchase_order_lines pol where pol.order_id=new.id and pol.company_id=new.company_id and pol.business_unit_id=v_bu group by pol.item_id order by pol.item_id loop
  v_item_alloc:=case when v_total_item_value>0 then v_landed*coalesce(r.total_val,0)/v_total_item_value else 0 end;
  v_direct_alloc:=case when coalesce(r.total_val,0)>0 then v_item_alloc*coalesce(r.direct_val,0)/r.total_val else 0 end; v_linked_alloc:=v_item_alloc-v_direct_alloc;
  if coalesce(r.direct_qty,0)>0 then select coalesce(sum(ws.quantity),0) into v_current from public.warehouse_stock ws where ws.company_id=new.company_id and ws.business_unit_id=v_bu and ws.item_id=r.item_id; v_old:=greatest(v_current-r.direct_qty,0); perform public.apply_inventory_cost_in(r.item_id,v_old,r.direct_qty,(coalesce(r.direct_val,0)*v_rate+v_direct_alloc)/r.direct_qty); end if;
  if v_linked_alloc>0 then perform public.add_inventory_value_adjustment(r.item_id,v_linked_alloc); end if;
 end loop; return new;
end $$;
revoke all on function public.sync_purchase_inventory_cost() from public,anon,authenticated;
commit;