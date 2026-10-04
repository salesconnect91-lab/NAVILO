create or replace function public.transport_post_customer_bill_settled(
 p_trip_id uuid,p_date date,p_with_tax boolean default false,p_account_id uuid default null,p_method text default null,p_invoice_no text default null,p_description text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r jsonb;bal numeric;receipt jsonb;
begin
 perform public.transport_finance_assert('billing');
 t:=public.transport_financial_trip(p_trip_id);
 if t.sale_type is distinct from 'cash' then raise exception 'Cash Transport Trip required';end if;
 perform public.transport_finance_assert('settlement');
 if p_account_id is null or p_method not in ('cash','bank') then raise exception 'Cash/Bank account and method required for Cash Transport billing';end if;
 if not exists(select 1 from public.chart_of_accounts a where a.id=p_account_id and a.company_id=t.company_id and a.is_active and not a.is_group and a.detail_type=case when p_method='bank' then 'Bank Account' else 'Cash on Hand' end)
 then raise exception 'Valid active Cash/Bank account required';end if;
 r:=public.transport_post_customer_bill_described(p_trip_id,p_date,p_with_tax,p_invoice_no,p_description);
 select outstanding_gross into bal from public.transport_service_balance_for_order('customer',(r->>'document_id')::uuid);
 if bal is null or bal<=0 then raise exception 'Posted Cash bill has no receivable balance to settle';end if;
 receipt:=public.transport_settle_documents('customer',t.customer_id,p_date,p_account_id,p_method,
   jsonb_build_array(jsonb_build_object('document_id',(r->>'document_id')::uuid,'amount',bal)),null,'Cash Transport Bill');
 return r||jsonb_build_object('cash_receipt',receipt,'settled_gross',bal);
end $$;
revoke all on function public.transport_post_customer_bill_settled(uuid,date,boolean,uuid,text,text,text) from public,anon;
grant execute on function public.transport_post_customer_bill_settled(uuid,date,boolean,uuid,text,text,text) to authenticated,service_role;