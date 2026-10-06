-- Synced from verified production migration 20261006195648 (allow_test_reset_transport_trip_cleanup).
create or replace function public.transport_trip_delete_guard()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return old; end if;
 raise exception 'Transport Trip deletion requires a controlled audited operation';
end $$;
create or replace function public.transport_posted_rate_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare effect boolean;
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 select exists(select 1 from public.transport_customer_document_trips where trip_id=old.id) or exists(select 1 from public.transport_supplier_document_rents where trip_id=old.id) or exists(select 1 from public.transport_driver_accrual_attributions where trip_id=old.id) or exists(select 1 from public.transport_driver_payment_attributions where trip_id=old.id) or exists(select 1 from public.transport_service_cost_links where trip_id=old.id) or old.sales_order_id is not null into effect;
 if tg_op='DELETE' then if old.status<>'draft' or effect then raise exception 'Only a Draft Trip without financial effect may be deleted'; end if;return old;end if;
 if (new.company_id,new.business_unit_id,new.trip_no) is distinct from (old.company_id,old.business_unit_id,old.trip_no) then raise exception 'Trip workspace and company-wide number are immutable'; end if;
 if exists(select 1 from public.transport_customer_document_trips where trip_id=old.id) or old.sales_order_id is not null then if (new.customer_id,new.sale_type,new.customer_rate,new.sales_order_id) is distinct from (old.customer_id,old.sale_type,old.customer_rate,old.sales_order_id) then raise exception 'Posted customer billing amounts and payer identity are read-only; use Rate Adjustment';end if;end if;
 if exists(select 1 from public.transport_supplier_document_rents where trip_id=old.id) and (new.owner_rent,new.supplier_rent) is distinct from(old.owner_rent,old.supplier_rent) then raise exception 'Posted supplier rates are read-only; use Rate Adjustment';end if;
 if new.driver_pay is distinct from old.driver_pay then perform public.transport_finance_assert('driver');end if;
 if effect and new.status='cancelled' then raise exception 'Financial Trip cannot be silently cancelled'; end if;
 if (new.driver_pay is distinct from old.driver_pay or new.driver_id is distinct from old.driver_id) and (exists(select 1 from public.transport_driver_accrual_attributions where trip_id=old.id) or exists(select 1 from public.transport_driver_payment_attributions where trip_id=old.id)) then raise exception 'Attributed driver obligation and identity are immutable';end if;
 if (new.customer_rate,new.owner_rent) is distinct from (old.customer_rate,old.owner_rent) and old.status<>'draft' then perform public.transport_finance_assert('adjustment'); if nullif(btrim(new.notes),'') is null or new.notes is not distinct from old.notes then raise exception 'Completed unposted rate correction requires a new reason in Notes';end if; insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,event_type,old_data,new_data,changed_by) values(old.company_id,old.business_unit_id,old.id,'unposted_rate_correction',jsonb_build_object('customer_rate',old.customer_rate,'owner_rent',old.owner_rent),jsonb_build_object('customer_rate',new.customer_rate,'owner_rent',new.owner_rent,'customer_difference',new.customer_rate-old.customer_rate,'owner_difference',new.owner_rent-old.owner_rent,'reason',new.notes),auth.uid());end if;
 return new;
end $$;
