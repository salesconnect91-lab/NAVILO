-- Synced from verified production migration 20261006194957 (fix_test_company_reset_and_purge_guards).
create or replace function public.platform_purge_test_company(p_company_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company record; r record; n bigint; pass integer:=0; progress bigint; remaining bigint; deleted bigint:=0;
begin
 perform public.navilo_require_service_role_rpc();
 select id,name,code,is_test_company into v_company from public.companies where id=p_company_id for update;
 if not found then raise exception 'Company not found'; end if;
 if not coalesce(v_company.is_test_company,false) then raise exception 'Only an explicitly marked Test Company can be purged'; end if;
 perform set_config('app.maintenance_reset','1',true);
 update public.user_profiles p set
  last_company_id=case when p.last_company_id=p_company_id then null else p.last_company_id end,
  last_business_unit_id=case when p.last_business_unit_id in(select id from public.business_units where company_id=p_company_id) then null else p.last_business_unit_id end,
  locked_business_unit_id=case when p.locked_business_unit_id in(select id from public.business_units where company_id=p_company_id) then null else p.locked_business_unit_id end,
  locked_operating_location_id=case when p.locked_operating_location_id in(select id from public.operating_locations where company_id=p_company_id) then null else p.locked_operating_location_id end,
  updated_at=now()
 where p.last_company_id=p_company_id
 or p.last_business_unit_id in(select id from public.business_units where company_id=p_company_id)
 or p.locked_business_unit_id in(select id from public.business_units where company_id=p_company_id)
 or p.locked_operating_location_id in(select id from public.operating_locations where company_id=p_company_id);
 loop
  pass:=pass+1;progress:=0;
  for r in select distinct c.table_name from information_schema.columns c where c.table_schema='public' and c.column_name='company_id' and c.table_name not in('companies','platform_audit_logs') order by c.table_name loop
   begin execute format('delete from public.%I where company_id=$1',r.table_name) using p_company_id;get diagnostics n=row_count;progress:=progress+n;deleted:=deleted+n;
   exception when foreign_key_violation or raise_exception then null;end;
  end loop;
  exit when progress=0 or pass>=20;
 end loop;
 remaining:=0;
 for r in select distinct c.table_name from information_schema.columns c where c.table_schema='public' and c.column_name='company_id' and c.table_name not in('companies','platform_audit_logs') loop
  execute format('select count(*) from public.%I where company_id=$1',r.table_name) into n using p_company_id;remaining:=remaining+n;
 end loop;
 if remaining>0 then raise exception 'Test company purge blocked by % protected/dependent row(s). No data was deleted.',remaining;end if;
 insert into public.platform_audit_logs(actor_user_id,company_id,action,target_type,target_id,details) values(p_actor_id,p_company_id,'test_company_purge','company',p_company_id,jsonb_build_object('company_name',v_company.name,'company_code',v_company.code,'deleted_rows',deleted));
 delete from public.companies where id=p_company_id;
 if found then return jsonb_build_object('success',true,'deleted_company_id',p_company_id,'company_code',v_company.code,'deleted_rows',deleted);end if;
 raise exception 'Company could not be deleted. No purge was committed.';
end $$;
revoke all on function public.platform_purge_test_company(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_purge_test_company(uuid,uuid) to service_role;

create or replace function public.recalculate_purchase_order_payment_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_order uuid:=coalesce(new.purchase_order_id,old.purchase_order_id);
 v_user uuid:=coalesce(new.user_id,old.user_id);
 v_company uuid:=coalesce(new.company_id,old.company_id);
 v_unit uuid:=coalesce(new.business_unit_id,old.business_unit_id);
 v_total numeric:=0; v_returns numeric:=0; v_net_total numeric:=0; v_paid numeric:=0; v_out numeric:=0; v_status text:='unpaid';
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return coalesce(new,old); end if;
 select coalesce(total,0) into v_total from public.purchase_orders where id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
 if not found then raise exception 'Purchase invoice not found for payment allocation in its business unit.'; end if;
 select round(coalesce(sum(total),0),2) into v_returns from public.return_notes where purchase_order_id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit and note_type='purchase_debit' and status='posted';
 select round(coalesce(sum(amount),0),2) into v_paid from public.purchase_payment_allocations where purchase_order_id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
 v_total:=round(v_total,2); v_net_total:=greatest(round(v_total-v_returns,2),0); v_out:=greatest(round(v_net_total-v_paid,2),0);
 v_status:=case when v_net_total<=0.005 then case when v_paid>0.005 then 'overpaid' else 'paid' end when v_paid<=0.005 then 'unpaid' when v_paid<v_net_total-0.005 then 'partial' when v_paid>v_net_total+0.005 then 'overpaid' else 'paid' end;
 perform set_config('app.supplier_payment_update','1',true);
 update public.purchase_orders set paid_amount=v_paid,outstanding_amount=v_out,payment_status=v_status where id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
 return coalesce(new,old);
end $$;

create or replace function public.recalculate_sales_order_payment_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_order uuid:=coalesce(new.sales_order_id,old.sales_order_id);
 v_user uuid:=coalesce(new.user_id,old.user_id);
 v_company uuid:=coalesce(new.company_id,old.company_id);
 v_unit uuid:=coalesce(new.business_unit_id,old.business_unit_id);
 v_total numeric:=0; v_returns numeric:=0; v_net_total numeric:=0; v_paid numeric:=0; v_out numeric:=0; v_status text:='unpaid';
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return coalesce(new,old); end if;
 select coalesce(total,0) into v_total from public.sales_orders where id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
 if not found then raise exception 'Sales invoice not found for payment allocation in its business unit.'; end if;
 select round(coalesce(sum(total),0),2) into v_returns from public.return_notes where sales_order_id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit and note_type='sales_credit' and status='posted';
 select round(coalesce(sum(amount),0),2) into v_paid from public.invoice_payment_allocations where sales_order_id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
 v_total:=round(v_total,2); v_net_total:=greatest(round(v_total-v_returns,2),0); v_out:=greatest(round(v_net_total-v_paid,2),0);
 v_status:=case when v_net_total<=0.005 then case when v_paid>0.005 then 'overpaid' else 'paid' end when v_paid<=0.005 then 'unpaid' when v_paid<v_net_total-0.005 then 'partial' when v_paid>v_net_total+0.005 then 'overpaid' else 'paid' end;
 perform set_config('app.customer_payment_update','1',true);
 update public.sales_orders set paid_amount=v_paid,outstanding_amount=v_out,payment_status=v_status where id=v_order and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
 return coalesce(new,old);
end $$;

create or replace function public.recalculate_invoice_status_after_return_note()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_note_type text:=coalesce(new.note_type,old.note_type); v_sales uuid:=coalesce(new.sales_order_id,old.sales_order_id); v_purchase uuid:=coalesce(new.purchase_order_id,old.purchase_order_id);
 v_user uuid:=coalesce(new.user_id,old.user_id); v_company uuid:=coalesce(new.company_id,old.company_id); v_unit uuid:=coalesce(new.business_unit_id,old.business_unit_id);
 v_total numeric:=0; v_returns numeric:=0; v_net_total numeric:=0; v_paid numeric:=0; v_out numeric:=0; v_status text;
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return coalesce(new,old); end if;
 if current_setting('app.return_note_atomic_post', true)='1' then return coalesce(new,old); end if;
 if v_note_type='sales_credit' and v_sales is not null then
  select coalesce(total,0) into v_total from public.sales_orders where id=v_sales and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
  if found then
   select round(coalesce(sum(total),0),2) into v_returns from public.return_notes where sales_order_id=v_sales and user_id=v_user and company_id=v_company and business_unit_id=v_unit and note_type='sales_credit' and status='posted';
   select round(coalesce(sum(amount),0),2) into v_paid from public.invoice_payment_allocations where sales_order_id=v_sales and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
   v_net_total:=greatest(round(v_total-v_returns,2),0);v_out:=greatest(round(v_net_total-v_paid,2),0);
   v_status:=case when v_net_total<=0.005 then case when v_paid>0.005 then 'overpaid' else 'paid' end when v_paid<=0.005 then 'unpaid' when v_paid<v_net_total-0.005 then 'partial' when v_paid>v_net_total+0.005 then 'overpaid' else 'paid' end;
   perform set_config('app.customer_payment_update','1',true); update public.sales_orders set paid_amount=v_paid,outstanding_amount=v_out,payment_status=v_status where id=v_sales and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
  end if;
 elsif v_note_type='purchase_debit' and v_purchase is not null then
  select coalesce(total,0) into v_total from public.purchase_orders where id=v_purchase and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
  if found then
   select round(coalesce(sum(total),0),2) into v_returns from public.return_notes where purchase_order_id=v_purchase and user_id=v_user and company_id=v_company and business_unit_id=v_unit and note_type='purchase_debit' and status='posted';
   select round(coalesce(sum(amount),0),2) into v_paid from public.purchase_payment_allocations where purchase_order_id=v_purchase and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
   v_net_total:=greatest(round(v_total-v_returns,2),0);v_out:=greatest(round(v_net_total-v_paid,2),0);
   v_status:=case when v_net_total<=0.005 then case when v_paid>0.005 then 'overpaid' else 'paid' end when v_paid<=0.005 then 'unpaid' when v_paid<v_net_total-0.005 then 'partial' when v_paid>v_net_total+0.005 then 'overpaid' else 'paid' end;
   perform set_config('app.supplier_payment_update','1',true); update public.purchase_orders set paid_amount=v_paid,outstanding_amount=v_out,payment_status=v_status where id=v_purchase and user_id=v_user and company_id=v_company and business_unit_id=v_unit;
  end if;
 end if;
 return coalesce(new,old);
end $$;

create or replace function public.transport_archive_reversed_allocation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare side_name text;oid uuid;
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return old; end if;
 if tg_table_name='invoice_payment_allocations' then
  side_name:='customer';oid:=old.sales_order_id;
  if not exists(select 1 from public.transport_customer_documents where sales_order_id=oid) then return old;end if;
 else
  side_name:='supplier';oid:=old.purchase_order_id;
  if not exists(select 1 from public.transport_supplier_documents where purchase_order_id=oid) and not exists(select 1 from public.transport_service_cost_links where purchase_order_id=oid) then return old;end if;
 end if;
 if not exists(select 1 from public.journal_entries where reversal_of_entry_id=old.journal_entry_id and status='posted' and company_id=old.company_id and business_unit_id=old.business_unit_id and operating_location_id=old.operating_location_id) then raise exception 'Transport allocation deletion requires posted canonical reversal';end if;
 insert into public.transport_reversed_allocation_evidence(side,allocation_id,order_id,journal_entry_id,company_id,business_unit_id,operating_location_id,amount,allocation_date,archived_by)
 values(side_name,old.id,oid,old.journal_entry_id,old.company_id,old.business_unit_id,old.operating_location_id,old.amount,old.allocation_date,auth.uid());
 return old;
end $$;
