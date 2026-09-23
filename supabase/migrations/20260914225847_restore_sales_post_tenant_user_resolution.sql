do $$
declare v_def text; v_new text;
begin
 if to_regprocedure('public.post_sales_invoice_core(uuid)') is null then raise exception 'post_sales_invoice_core(uuid) is required before tenant user resolution hardening'; end if;
 select pg_get_functiondef('public.post_sales_invoice_core(uuid)'::regprocedure) into v_def;
 v_new:=replace(v_def,'v_user_id uuid := public.legacy_data_user_id();','v_user_id uuid;');
 v_new:=regexp_replace(v_new,'if v_user_id is null then.*?if not found then\s+raise exception ''Sales invoice not found or access denied\.'';\s+end if;',E'select *\n  into v_order\n  from public.sales_orders\n  where id = p_order_id\n    and company_id = public.current_company_id()\n    and business_unit_id = public.current_business_unit_id()\n  for update;\n\n  if not found then\n    raise exception ''Sales invoice not found or access denied.'';\n  end if;\n\n  v_user_id := v_order.user_id;\n  if v_user_id is null then\n    raise exception ''Invoice owner context is missing.'';\n  end if;','s');
 if v_new=v_def then raise exception 'post_sales_invoice_core patch pattern did not match'; end if;
 execute v_new;
end $$;

create or replace function public.post_sales_invoice(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_uid uuid; v_mode text; v_customer uuid; v_result jsonb;
begin
 perform public.assert_module_permission('sales','post');
 if auth.uid() is null or v_company is null or v_bu is null then raise exception 'Authentication, active company and business unit are required.'; end if;
 select customer_id,coalesce(payment_mode,'Credit'),user_id into v_customer,v_mode,v_uid from public.sales_orders where id=p_order_id and company_id=v_company and business_unit_id=v_bu for update;
 if not found then raise exception 'Sales invoice not found in active business unit.'; end if;
 if v_customer is null then raise exception 'Customer is required for every Main Sales Invoice, including cash/bank sales.'; end if;
 update public.sales_orders set settlement_method=case when v_mode in ('Cash','Bank','Credit') then v_mode else 'Credit' end,payment_mode='Credit',payment_account_id=null,updated_at=now() where id=p_order_id and company_id=v_company and business_unit_id=v_bu and status<>'posted';
 v_result:=public.post_sales_invoice_core(p_order_id);
 return v_result||jsonb_build_object('settlement_method',case when v_mode in ('Cash','Bank','Credit') then v_mode else 'Credit' end,'receipt_posted_separately',true);
end;$$;
grant execute on function public.post_sales_invoice(uuid) to authenticated;