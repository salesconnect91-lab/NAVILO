-- Request evidence only; Sales invoice, receipt and journals remain canonical.
create table public.transport_cash_sale_requests (
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 request_id uuid not null,created_by uuid not null,payload jsonb not null,result jsonb,
 created_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,operating_location_id,request_id)
);
alter table public.transport_cash_sale_requests enable row level security;
revoke all on public.transport_cash_sale_requests from public,anon,authenticated;

create function public.transport_post_cash_bill_receive(p_request_id uuid,p_trip_id uuid,p_date date,
 p_account_id uuid,p_method text,p_with_tax boolean default false,p_reference text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 t public.transport_trips%rowtype;stored public.transport_cash_sale_requests%rowtype;body jsonb;bill jsonb;receipt jsonb;outcome jsonb;gross numeric;
begin
 perform public.transport_finance_assert('billing');perform public.transport_finance_assert('settlement');
 if p_request_id is null or p_date is null or p_account_id is null or p_method is null or p_method not in ('cash','bank') or loc is null then raise exception 'Request, date, cash/bank account and method required';end if;
 body:=jsonb_build_object('trip',p_trip_id,'date',p_date,'account',p_account_id,'method',p_method,'vat',p_with_tax,'reference',p_reference);
 insert into public.transport_cash_sale_requests(company_id,business_unit_id,operating_location_id,request_id,created_by,payload)
 values(c,b,loc,p_request_id,auth.uid(),body) on conflict do nothing;
 select * into strict stored from public.transport_cash_sale_requests where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id for update;
 if stored.created_by<>auth.uid() or stored.payload<>body then raise exception 'Cash request reused with different actor or payload';end if;
 if stored.result is not null then return stored.result;end if;
 t:=public.transport_financial_trip(p_trip_id);
 if t.sale_type<>'cash' or t.customer_rate_state<>'finalized' then raise exception 'Cash Trip with finalized customer rate required';end if;
 bill:=public.transport_post_customer_bill(p_trip_id,p_date,p_with_tax);
 gross:=(bill->>'net')::numeric+(bill->>'vat')::numeric;
 receipt:=public.transport_settle_reviewed_documents(p_request_id,'customer',t.customer_id,p_date,p_account_id,p_method,
 jsonb_build_array(jsonb_build_object('document_id',(bill->>'document_id')::uuid,'amount',gross)),p_reference);
 outcome:=jsonb_build_object('success',true,'bill',bill,'receipt',receipt,'received_gross',gross);
 update public.transport_cash_sale_requests set result=outcome where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id;
 perform public.transport_financial_audit(p_trip_id,'cash_bill_received',outcome);
 return outcome;
end $$;
revoke all on function public.transport_post_cash_bill_receive(uuid,uuid,date,uuid,text,boolean,text) from public,anon;
grant execute on function public.transport_post_cash_bill_receive(uuid,uuid,date,uuid,text,boolean,text) to authenticated;
