begin;
create or replace function public.transport_v1_stamp()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $stamp$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'')='1' then return new; end if;
 if tg_op='INSERT' then
  new.company_id:=coalesce(new.company_id,public.current_company_id());
  new.business_unit_id:=coalesce(new.business_unit_id,public.current_business_unit_id());
  new.created_by:=coalesce(new.created_by,auth.uid());
 end if;
 if new.company_id is distinct from public.current_company_id() or new.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport record must belong to active company and business unit';end if;
 if not exists(select 1 from public.business_units where id=new.business_unit_id and company_id=new.company_id and unit_type='transport' and is_active)
 then raise exception 'Active Transport business unit required';end if;
 if tg_table_name='transport_trips' then
  if tg_op='INSERT' then
   if new.trip_no is null or btrim(new.trip_no)='' then new.trip_no:=public.next_transport_trip_no();end if;
   new.customer_rate:=coalesce(new.customer_rate,0);
   new.owner_rent:=coalesce(new.supplier_rent,new.owner_rent,0);
   new.supplier_rent:=new.owner_rent;
  else
   if new.owner_rent is distinct from old.owner_rent then new.supplier_rent:=new.owner_rent;
   elsif new.supplier_rent is distinct from old.supplier_rent then new.owner_rent:=coalesce(new.supplier_rent,0);end if;
  end if;
  new.updated_by:=auth.uid();new.updated_at:=now();
 end if;
 return new;
end $stamp$;
select set_config('app.maintenance_reset','1',true);
alter table public.transport_trips add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.transport_trip_audit add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.transport_trip_expenses add column if not exists operating_location_id uuid references public.operating_locations(id);
alter table public.transport_trips disable trigger user;

-- Historical rows are attributed without rewriting Trip commercial evidence.
-- The existing Transport scope/audit triggers intentionally reject cross-context UPDATEs,
-- so branch attribution is derived from immutable posted evidence or the only active branch.
do $$
declare r record;loc uuid;
begin
 for r in select id,company_id,business_unit_id from public.transport_trips where operating_location_id is null loop
  loc:=null;
  select q.operating_location_id into loc from (
   select d.operating_location_id
   from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id
   where l.trip_id=r.id and not l.is_adjustment and d.operating_location_id is not null
   union
   select d.operating_location_id
   from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id
   where l.trip_id=r.id and not l.is_adjustment and d.operating_location_id is not null
  ) q limit 1;
  if loc is null then
   select x.id into loc from public.operating_locations x
   where x.company_id=r.company_id and x.business_unit_id=r.business_unit_id and x.is_active
   order by x.id::text limit 1;
   if (select count(*) from public.operating_locations x where x.company_id=r.company_id and x.business_unit_id=r.business_unit_id and x.is_active)<>1 then
    raise exception 'Transport branch migration blocked: ambiguous historical Trip branch exists for %',r.id;
   end if;
  end if;
  update public.transport_trips set operating_location_id=loc where id=r.id;
 end loop;
end $$;

alter table public.transport_trips alter column operating_location_id set not null;
alter table public.transport_trips enable trigger trg_transport_trips_scope;
alter table public.transport_trips enable trigger trg_transport_trip_audit;

update public.transport_trip_audit a set operating_location_id=t.operating_location_id
from public.transport_trips t where a.trip_id=t.id and a.operating_location_id is null;
update public.transport_trip_expenses e set operating_location_id=t.operating_location_id
from public.transport_trips t where e.trip_id=t.id and e.operating_location_id is null;

create index if not exists transport_trips_branch_register_idx on public.transport_trips(company_id,business_unit_id,operating_location_id,trip_date desc,trip_no desc,id);
create index if not exists transport_trip_audit_branch_trip_idx on public.transport_trip_audit(company_id,business_unit_id,operating_location_id,upper(btrim(trip_no)),changed_at,id);
create index if not exists transport_trip_expenses_branch_idx on public.transport_trip_expenses(company_id,business_unit_id,operating_location_id,trip_id,expense_date);

create or replace function public.transport_trip_branch_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare loc uuid:=public.current_operating_location_id();
begin
 if tg_op='INSERT' then
  if loc is null then raise exception 'Active operating location required for Transport Trip'; end if;
  if new.operating_location_id is null then new.operating_location_id:=loc; end if;
  if new.operating_location_id is distinct from loc or not exists(
   select 1 from public.operating_locations ol where ol.id=new.operating_location_id and ol.company_id=new.company_id and ol.business_unit_id=new.business_unit_id and ol.is_active
  ) then raise exception 'Transport Trip branch must match the active Company/Business Unit/branch'; end if;
 elsif new.operating_location_id is distinct from old.operating_location_id and coalesce(current_setting('app.maintenance_reset',true),'')<>'1' then
  raise exception 'Transport Trip branch is immutable; use controlled correction';
 end if;
 return new;
end $$;
drop trigger if exists transport_trip_branch_guard on public.transport_trips;
create trigger transport_trip_branch_guard before insert or update on public.transport_trips for each row execute function public.transport_trip_branch_guard();

create or replace function public.transport_audit_branch_fill() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.operating_location_id is null and new.trip_id is not null then
  select t.operating_location_id into new.operating_location_id from public.transport_trips t where t.id=new.trip_id;
 end if;
 if new.operating_location_id is null then new.operating_location_id:=public.current_operating_location_id(); end if;
 return new;
end $$;
drop trigger if exists transport_audit_branch_fill on public.transport_trip_audit;
create trigger transport_audit_branch_fill before insert on public.transport_trip_audit for each row execute function public.transport_audit_branch_fill();


CREATE OR REPLACE FUNCTION public.transport_register_query(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT ''::text, p_direction text DEFAULT 'asc'::text, p_option_key text DEFAULT NULL::text, p_option_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;needs_cells boolean;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid filters';end if;
 if (p_option_key=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or p_sort=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or (coalesce(p_filters->'columns','{}') ?| array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced'])) and not cv then raise exception 'Customer financial view permission required';end if;
 if (p_option_key=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner']) or p_sort=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner']) or (coalesce(p_filters->'columns','{}') ?| array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner'])) and not sv then raise exception 'Supplier financial view permission required';end if;
 if (p_sort='profit' or p_option_key='profit' or coalesce(p_filters->'columns','{}') ? 'profit') and not (cv and sv) then raise exception 'Both financial view permissions required';end if;
 if p_filters->>'snapshot'='true' and not public.has_module_permission(c,'transport','export') then raise exception 'Transport export permission required';end if;
 needs_cells:=p_filters->>'snapshot'='true' or p_option_key is not null or coalesce(p_sort,'')<>'' or coalesce(p_filters->>'search','')<>'' or exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f where jsonb_array_length(f.value)>0);
 with agreed_rents as materialized (
  select trip_id,sum(coalesce(finalized_amount_snapshot,amount)) amount
  from public.transport_trip_supplier_rents
  where company_id=c and business_unit_id=b group by trip_id
 ),
 customer_charge_agg as materialized (
  select trip_id,sum(amount) amount
  from public.transport_trip_customer_charges
  where company_id=c and business_unit_id=b group by trip_id
 ),
 supplier_charge_agg as materialized (
  select trip_id,sum(amount) amount,
         string_agg(charge_key_snapshot,' + ' order by sort_order,id) charge_names
  from public.transport_trip_supplier_charges
  where company_id=c and business_unit_id=b group by trip_id
 ),
 customer_invoice_agg as materialized (
  select distinct on (l.trip_id) l.trip_id,s.order_no
  from public.transport_customer_document_trips l
  join public.transport_customer_documents d on d.id=l.document_id
  join public.sales_orders s on s.id=d.sales_order_id
  where cv and not l.is_adjustment
  order by l.trip_id,l.id
 ),
 supplier_status_agg as materialized (
  select r.trip_id,
         count(*) rent_count,
         bool_and(r.state='finalized') all_finalized,
         bool_and(exists(
           select 1
           from public.transport_supplier_document_rents l
           join public.transport_supplier_documents d on d.id=l.document_id
           join public.transport_active_journals j on j.id=d.journal_entry_id
           where l.rent_id=r.id and not l.is_adjustment
         )) all_posted
  from public.transport_trip_supplier_rents r
  where r.company_id=c and r.business_unit_id=b
  group by r.trip_id
 ), scoped as materialized (
  select r.id,r.trip_date,r.payment_date,r.trip_no,
  case
   when coalesce(r.customer_rate_locked,false)
    and ((coalesce(r.owner_rent,0)>0 or coalesce(ssa.rent_count,0)>0) and coalesce(r.supplier_rate_locked,false) and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_posted,false) else true end)
    and coalesce(r.customer_outstanding_gross,0)<=0.005 and coalesce(r.supplier_outstanding_gross,0)<=0.005 then 'settled'
   when coalesce(r.customer_rate_locked,false)
    and ((coalesce(r.owner_rent,0)>0 or coalesce(ssa.rent_count,0)>0) and coalesce(r.supplier_rate_locked,false) and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_posted,false) else true end) then 'locked'
   when coalesce(r.customer_rate_state,'pending')='finalized'
    and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_finalized,false) else coalesce(r.rent_state,'pending')='finalized' end then 'complete'
   when coalesce(r.customer_rate_state,'pending')='finalized'
    or case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_finalized,false) else coalesce(r.rent_state,'pending')='finalized' end then 'incomplete'
   else 'draft'
  end status,
  r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,case when cv then coalesce(cca.amount,0) else 0 end n_customer_charges,coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0) n_rent_driver,case when sv then coalesce(sca.amount,0) else 0 end n_supplier_charges,coalesce(r.supplier_paid_net,0) n_supplier_paid,greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0) n_supplier_balance,greatest(coalesce(r.supplier_credit_gross,0),0) n_supplier_credit,coalesce(r.driver_accrued,r.driver_pay,0) n_driver_pay,coalesce(r.driver_paid,0) n_driver_paid,coalesce(r.driver_outstanding,0) n_driver_balance,coalesce(r.payment_amount,0) n_amount,coalesce(r.billed_customer_net,r.customer_rate,0) n_company_rate,coalesce(r.received_from_company,0) n_received_company,greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0) n_remaining_company,greatest(coalesce(r.customer_credit_gross,0),0) n_customer_credit,coalesce(r.trip_profit,0) n_profit,coalesce(r.commission_paid_net,0) n_commission,case when cv then cia.order_no end invoice_no_raw,jsonb_build_object('cells',case when needs_cells then jsonb_build_object(
'trip_no',coalesce(nullif(r.trip_no,''),'?'),
'trip_date',coalesce(nullif(to_char(r.trip_date,'DD-Mon-YY'),''),'?'),
'truck_type',coalesce(nullif(r.truck_type_name,''),'?'),
'job_no',coalesce(nullif(r.po_do_job_no,''),'?'),
'invoiced',coalesce(nullif(case when r.invoiced then 'Yes' else 'No' end,''),'?'),
'company',coalesce(nullif(r.customer_name,''),'?'),
'driver',coalesce(nullif(r.driver_name,''),'?'),
'owner',coalesce(nullif(r.owner_name,''),'?'),
'plate',coalesce(nullif(r.vehicle_no,''),'?'),
'from',coalesce(nullif(r.from_location,''),'?'),
'to',coalesce(nullif(r.to_location,''),'?'),
'charge',to_char(case when cv then coalesce(cca.amount,0) else 0 end,'FM999,999,999,999,999,990.00'),
'supplier_charge',case when sv then coalesce(nullif(sca.charge_names,''),'?') else '?' end,
'paper_received_by',coalesce(nullif(case when r.ppr_status='received' then coalesce(nullif(r.ppr_received_by_name,''),'—')||coalesce(' · '||to_char(r.ppr_received_date,'DD-Mon-YY'),'') else 'Pending' end,''),'?'),
'payment_date',coalesce(nullif(to_char(r.payment_date,'DD-Mon-YY'),''),'?'),
'invoice_no',coalesce(nullif(case when cv then cia.order_no end,''),'?'),
'sale_type',coalesce(nullif(r.sale_type,''),'?'),
'rent_driver',to_char(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0),'FM999,999,999,999,999,990.00'),
'supplier_charges',to_char(case when sv then coalesce(sca.amount,0) else 0 end,'FM999,999,999,999,999,990.00'),
'supplier_paid',to_char(coalesce(r.supplier_paid_net,0),'FM999,999,999,999,999,990.00'),
'supplier_balance',to_char(greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0),'FM999,999,999,999,999,990.00'),
'supplier_credit',to_char(greatest(coalesce(r.supplier_credit_gross,0),0),'FM999,999,999,999,999,990.00'),
'driver_pay',to_char(coalesce(r.driver_accrued,r.driver_pay,0),'FM999,999,999,999,999,990.00'),
'driver_paid',to_char(coalesce(r.driver_paid,0),'FM999,999,999,999,999,990.00'),
'driver_balance',to_char(coalesce(r.driver_outstanding,0),'FM999,999,999,999,999,990.00'),
'amount',to_char(coalesce(r.payment_amount,0),'FM999,999,999,999,999,990.00'),
'company_rate',to_char(coalesce(r.billed_customer_net,r.customer_rate,0),'FM999,999,999,999,999,990.00'),
'received_company',to_char(coalesce(r.received_from_company,0),'FM999,999,999,999,999,990.00'),
'remaining_company',to_char(greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0),'FM999,999,999,999,999,990.00'),
'customer_credit',to_char(greatest(coalesce(r.customer_credit_gross,0),0),'FM999,999,999,999,999,990.00'),
'profit',to_char(coalesce(r.trip_profit,0),'FM999,999,999,999,999,990.00'),
'commission',to_char(coalesce(r.commission_paid_net,0),'FM999,999,999,999,999,990.00')) else '{}'::jsonb end, 'numbers',case when needs_cells then jsonb_build_object(
'charge',case when cv then coalesce(cca.amount,0) else 0 end,
'rent_driver',coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0),
'supplier_paid',coalesce(r.supplier_paid_net,0),
'supplier_balance',greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0),
'supplier_credit',greatest(coalesce(r.supplier_credit_gross,0),0),
'driver_pay',coalesce(r.driver_accrued,r.driver_pay,0),
'driver_paid',coalesce(r.driver_paid,0),
'driver_balance',coalesce(r.driver_outstanding,0),
'amount',coalesce(r.payment_amount,0),
'company_rate',coalesce(r.billed_customer_net,r.customer_rate,0),
'received_company',coalesce(r.received_from_company,0),
'remaining_company',greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0),
'customer_credit',greatest(coalesce(r.customer_credit_gross,0),0),
'profit',coalesce(r.trip_profit,0),
'commission',coalesce(r.commission_paid_net,0)) else '{}'::jsonb end) vals from (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc) union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc)) r left join agreed_rents ar on ar.trip_id=r.id
    left join customer_charge_agg cca on cca.trip_id=r.id
    left join supplier_charge_agg sca on sca.trip_id=r.id
    left join customer_invoice_agg cia on cia.trip_id=r.id
    left join supplier_status_agg ssa on ssa.trip_id=r.id
  where r.company_id=c and r.business_unit_id=b
   and (coalesce(p_filters->>'fromDate','')='' or r.trip_date>=(p_filters->>'fromDate')::date)
   and (coalesce(p_filters->>'toDate','')='' or r.trip_date<=(p_filters->>'toDate')::date)
   and (coalesce(p_filters->>'customer','')='' or r.customer_name=p_filters->>'customer')
   and (coalesce(p_filters->>'driver','')='' or r.driver_name=p_filters->>'driver')
   and (coalesce(p_filters->>'vehicle','')='' or r.vehicle_no=p_filters->>'vehicle')
   and (coalesce(p_filters->>'from','')='' or r.from_location=p_filters->>'from')
   and (coalesce(p_filters->>'to','')='' or r.to_location=p_filters->>'to')
   and (coalesce(p_filters->>'ppr','')='' or r.ppr_status=p_filters->>'ppr')
 ), filtered as materialized (
  select * from scoped x where
   (coalesce(jsonb_array_length(p_filters->'statuses'),0)=0 or exists(select 1 from jsonb_array_elements_text(p_filters->'statuses') s
    where s='status:'||x.status))
   and (coalesce(btrim(p_filters->>'search'),'')='' or position(
     lower(replace(btrim(p_filters->>'search'),',',''))
     in lower(replace(concat_ws(' ',
       x.vals->'cells'->>'trip_no',x.vals->'cells'->>'trip_date',x.vals->'cells'->>'truck_type',
       x.vals->'cells'->>'job_no',x.vals->'cells'->>'invoiced',x.vals->'cells'->>'company',
       x.vals->'cells'->>'driver',x.vals->'cells'->>'owner',x.vals->'cells'->>'plate',
       x.vals->'cells'->>'from',x.vals->'cells'->>'to',x.vals->'cells'->>'charge',x.vals->'cells'->>'supplier_charge',x.vals->'cells'->>'supplier_charges',x.vals->'cells'->>'paper_received_by',
       x.vals->'cells'->>'rent_driver',x.vals->'cells'->>'supplier_paid',x.vals->'cells'->>'supplier_balance',
       x.vals->'cells'->>'supplier_credit',x.vals->'cells'->>'driver_pay',x.vals->'cells'->>'driver_paid',
       x.vals->'cells'->>'driver_balance',x.vals->'cells'->>'payment_date',x.vals->'cells'->>'amount',
       x.vals->'cells'->>'company_rate',x.vals->'cells'->>'received_company',x.vals->'cells'->>'remaining_company',
       x.vals->'cells'->>'customer_credit',x.vals->'cells'->>'profit',x.vals->'cells'->>'commission',
       x.vals->'cells'->>'invoice_no',x.vals->'cells'->>'sale_type',x.status,x.ppr_status
     ),',',''))
   )>0)
   and not exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f
    where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
     and not f.value @> jsonb_build_array(x.vals->'cells'->>f.key))
 ), chosen as materialized (
  select x.id,x.status,x.n_customer_charges customer_charges,x.n_rent_driver rent,x.n_supplier_charges supplier_charges,x.invoice_no_raw invoice_no,row_number() over(order by case when p_direction='asc' and p_sort='trip_date' then x.trip_date end asc,
   case when p_direction='desc' and p_sort='trip_date' then x.trip_date end desc,
   case when p_direction='asc' and p_sort='payment_date' then x.payment_date end asc,
   case when p_direction='desc' and p_sort='payment_date' then x.payment_date end desc,
   case when p_direction='asc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end asc,
   case when p_direction='desc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end desc,
   case when p_direction='asc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end asc,
   case when p_direction='desc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end desc,
   x.trip_date desc,x.trip_no desc,x.id) ordinal
  from filtered x
  order by
   case when p_direction='asc' and p_sort='trip_date' then x.trip_date end asc,
   case when p_direction='desc' and p_sort='trip_date' then x.trip_date end desc,
   case when p_direction='asc' and p_sort='payment_date' then x.payment_date end asc,
   case when p_direction='desc' and p_sort='payment_date' then x.payment_date end desc,
   case when p_direction='asc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end asc,
   case when p_direction='desc' and x.vals->'numbers' ? p_sort then (x.vals->'numbers'->>p_sort)::numeric end desc,
   case when p_direction='asc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end asc,
   case when p_direction='desc' and p_sort not in ('trip_date','payment_date') and not x.vals->'numbers' ? p_sort then x.vals->'cells'->>p_sort end desc,
   x.trip_date desc,x.trip_no desc,x.id
  limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)
 ), page as (
  select public._transport_mask_financial_row(to_jsonb(r),cv,sv)||jsonb_build_object('status',chosen.status,'customer_charges',chosen.customer_charges,'supplier_rent',chosen.rent,'supplier_charges',chosen.supplier_charges,'invoice_no',case when cv then nullif(chosen.invoice_no,'') end) row,chosen.ordinal
  from chosen join (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc) union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc)) r on r.id=chosen.id and r.company_id=c and r.business_unit_id=b
 ), filtered_agg as materialized (
  select
   count(*) row_count,
   count(*) filter (where status in ('complete','locked','settled')) completed_count,
   count(*) filter (where ppr_status='received') paper_received_count,
   count(*) filter (where ppr_status is distinct from 'received') paper_pending_count,
   count(*) filter (where n_received_company>0) collection_received_count,
   count(*) filter (where n_received_company<=0) collection_pending_count,
   count(*) filter (where n_supplier_paid>0) supplier_paid_count,
   count(*) filter (where n_supplier_paid<=0) supplier_unpaid_count,
   jsonb_build_object('charge',coalesce(sum(x.n_customer_charges),0),'rent_driver',coalesce(sum(x.n_rent_driver),0),'supplier_charges',coalesce(sum(x.n_supplier_charges),0),'supplier_paid',coalesce(sum(x.n_supplier_paid),0),'supplier_balance',coalesce(sum(x.n_supplier_balance),0),'supplier_credit',coalesce(sum(x.n_supplier_credit),0),'driver_pay',coalesce(sum(x.n_driver_pay),0),'driver_paid',coalesce(sum(x.n_driver_paid),0),'driver_balance',coalesce(sum(x.n_driver_balance),0),'amount',coalesce(sum(x.n_amount),0),'company_rate',coalesce(sum(x.n_company_rate),0),'received_company',coalesce(sum(x.n_received_company),0),'remaining_company',coalesce(sum(x.n_remaining_company),0),'customer_credit',coalesce(sum(x.n_customer_credit),0),'profit',coalesce(sum(x.n_profit),0),'commission',coalesce(sum(x.n_commission),0)) totals
  from filtered x
 ),
 options as (select distinct x.vals->'cells'->>p_option_key value from filtered x
  where position(
 lower(case when x.vals->'numbers' ? p_option_key then replace(btrim(coalesce(p_option_search,'')),',','') else btrim(coalesce(p_option_search,'')) end)
 in lower(case when x.vals->'numbers' ? p_option_key then replace(x.vals->'cells'->>p_option_key,',','') else x.vals->'cells'->>p_option_key end))>0
  order by value limit 200),
 statuses as (
  select v.key,v.label,v.narration,v.sort_order,count(x.id) count
  from (values
    ('status:draft','Draft','No customer or supplier rate has been finalized yet.',1),
    ('status:incomplete','Incomplete','Only one of Customer Rate or Supplier Rent is finalized; the other side is still pending.',2),
    ('status:complete','Complete','Customer Rate and Supplier Rent are both finalized, but both financial sides are not yet posted.',3),
    ('status:locked','Locked','Customer billing and every required Supplier Rent are posted. Normal Trip/commercial editing is locked.',4),
    ('status:settled','Settled','Both sides are posted and Customer/Supplier outstanding balances are fully settled.',5)
  ) v(key,label,narration,sort_order)
  left join scoped x on 'status:'||x.status=v.key
  group by v.key,v.label,v.narration,v.sort_order
)
 select case when p_option_key is not null then jsonb_build_object('options',coalesce((select jsonb_agg(value) from options),'[]'))
 else jsonb_build_object('snapshot',case when p_filters->>'snapshot'='true' then (select md5(coalesce(string_agg(id::text||md5(concat_ws('|',status,financial_status,ppr_status,vals::text)),'' order by id),'')) from filtered) end,'rows',coalesce((select jsonb_agg(row order by ordinal) from page),'[]'),'count',(select row_count from filtered_agg),
  'completed',(select completed_count from filtered_agg),
  'paper_pending',(select paper_pending_count from filtered_agg),
  'summary',jsonb_build_object(
    'paper',jsonb_build_object('received',(select paper_received_count from filtered_agg),'not_received',(select paper_pending_count from filtered_agg)),
    'collections',case when cv then jsonb_build_object('received',(select collection_received_count from filtered_agg),'not_received',(select collection_pending_count from filtered_agg)) else null end,
    'payment',case when sv then jsonb_build_object('paid',(select supplier_paid_count from filtered_agg),'not_paid',(select supplier_unpaid_count from filtered_agg)) else null end
  ),
  'statuses',coalesce((select jsonb_agg(to_jsonb(statuses)-'sort_order' order by sort_order) from statuses),'[]'),
  'totals',coalesce((select totals from filtered_agg),'{}')) end into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));
 answer:=jsonb_set(answer,'{totals}',public._transport_mask_financial_row(answer->'totals',cv,sv));
 return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));
end $function$
;
notify pgrst,'reload schema';
commit;

CREATE OR REPLACE FUNCTION public.transport_bulk_rate_page(p_side text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if (coalesce(p_filters->'columns','{}') ?| array['rate','rateStatus']) and not public.transport_financial_read_allowed('customer') then raise exception 'Customer financial view permission required';end if;
 if (coalesce(p_filters->'columns','{}') ?| array['rent','rentStatus','owner']) and not public.transport_financial_read_allowed('supplier') then raise exception 'Supplier financial view permission required';end if;
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid bulk filters';end if;
 with base as materialized (
  select t.id,t.trip_no,t.trip_date,coalesce(t.lifecycle_status,t.status) trip_status,t.customer_id,coalesce(cu.name,t.customer_name_snapshot) customer_name,
   v.vehicle_no,dr.driver_name,t.from_location,t.to_location,t.po_do_job_no,t.sale_type,t.customer_rate,t.customer_rate_state,
   t.sales_order_id,t.owner_supplier_id,t.owner_name_snapshot,t.supplier_rent,t.owner_rent,t.rent_state,t.rent_finalized_at,
   (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips l where l.trip_id=t.id)) customer_rate_locked,
   case when p_side='customer' then (select r.billed_customer_net from public.transport_financial_register r where r.id=t.id) end billed_customer_net
  from public.transport_trips t left join public.customers cu on cu.id=t.customer_id
  left join public.transport_vehicles v on v.id=t.vehicle_id left join public.transport_drivers dr on dr.id=t.driver_id
  where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
   and (coalesce(p_filters->>'initialTrip','')='' or t.id::text=p_filters->>'initialTrip')
   and (coalesce(p_filters->>'status','')='' or t.status=p_filters->>'status')
   and (coalesce(p_filters->>'search','')='' or position(lower(btrim(p_filters->>'search')) in lower(concat_ws(' ',t.trip_no,t.po_do_job_no,cu.name,t.customer_name_snapshot,dr.driver_name,v.vehicle_no,t.from_location,t.to_location)))>0)
 ), lines as materialized (
  select to_jsonb(t)||jsonb_build_object('posted',t.customer_rate_locked) row,
   t.customer_id party,t.trip_date,t.trip_no,t.id::text key,
   case when t.customer_rate_locked then 'posted correction required' when t.customer_rate_state='finalized' then 'finalized editable until post' else 'pending ready to finalize' end state
  from base t where p_side='customer'
  union all
  select to_jsonb(t)||jsonb_build_object('id',coalesce(r.id::text,'new:'||t.id::text),'trip_id',t.id,'party_id',coalesce(r.supplier_id,t.owner_supplier_id),
   'owner_name',coalesce(s.name,r.supplier_name_snapshot,t.owner_name_snapshot),
   'posted',exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id),
   'legacyBlocked',r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null),
   'supplier_rent',coalesce(r.amount+a.difference,t.supplier_rent,t.owner_rent),
   'owner_rent',coalesce(r.amount+a.difference,t.supplier_rent,t.owner_rent),
   'billed_supplier_net',case when exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id) then r.amount+a.difference end,
   'rent',case when r.id is not null then to_jsonb(r)||jsonb_build_object('trip_id',t.id,'amount',r.amount+a.difference,'finalized_amount_snapshot',r.amount+a.difference) end),
   coalesce(r.supplier_id,t.owner_supplier_id),t.trip_date,t.trip_no,coalesce(r.id::text,'new:'||t.id::text),
   case when exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id) then 'posted correction required'
    when r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null) then 'legacy correction required'
    when r.state='finalized' then 'finalized editable until post' else 'pending ready to finalize' end
  from base t left join public.transport_trip_supplier_rents r on r.trip_id=t.id
  left join public.suppliers s on s.id=coalesce(r.supplier_id,t.owner_supplier_id)
  left join lateral(select coalesce(sum(difference),0) difference from public.transport_rate_adjustments a where a.rent_id=r.id and a.side='supplier') a on true
  where p_side='supplier'
 ), cells as (
  select l.*,jsonb_build_object('trip',row->>'trip_no','date',to_char(trip_date,'DD-Mon-YY'),'status',coalesce(row->>'trip_status','—'),
   'company',row->>'customer_name','route',coalesce(row->>'from_location','')||' '||coalesce(row->>'to_location',''),
   'vehicle',row->>'vehicle_no','driver',row->>'driver_name','job',row->>'po_do_job_no','sale',row->>'sale_type','owner',row->>'owner_name',
   'rate',case when (row->>'posted')::boolean then row->>'billed_customer_net' else row->>'customer_rate' end,
   'rent',row->>'supplier_rent','rateStatus',state,'rentStatus',state) as cell_values from lines l
 ), filtered as materialized (
  select * from cells x where (coalesce(p_filters->>'party','')='' or x.party::text=p_filters->>'party')
   and not exists(select 1 from jsonb_each_text(coalesce(p_filters->'columns','{}')) f
    where btrim(f.value)<>'' and position(
 lower(case when f.key in ('rate','rent') then replace(btrim(f.value),',','') else regexp_replace(btrim(f.value),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end)
 in lower(case when f.key in ('rate','rent') then replace(coalesce(x.cell_values->>f.key,''),',','') else regexp_replace(coalesce(x.cell_values->>f.key,''),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end))=0)
 ), page as (select row||jsonb_build_object('invoice_no',case when p_side='customer' then
 (select so.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where l.trip_id=(row->>'id')::uuid and not l.is_adjustment order by l.id limit 1)
 else (select po.order_no from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where l.rent_id=(row->'rent'->>'id')::uuid and not l.is_adjustment order by l.id limit 1) end) row from filtered order by trip_date desc,trip_no desc,key
  limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from page),'[]'),'count',(select count(*) from filtered),
  'amount',coalesce((select sum(case when p_side='supplier' then (row->>'supplier_rent')::numeric when (row->>'posted')::boolean then (row->>'billed_customer_net')::numeric else (row->>'customer_rate')::numeric end) from filtered),0),
  'statuses',coalesce((select jsonb_agg(status) from (select distinct trip_status status from base) s),'[]')) into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));return answer;
end $function$
;

create or replace function public.transport_trip_audit_report(p_trip_no text,p_limit integer default 500,p_offset integer default 0)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();n text:=upper(btrim(p_trip_no));answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if n is null or length(n) not between 1 and 120 then raise exception 'Enter an exact Trip No';end if;
 with filtered as materialized (
  select a.*,coalesce(u.email,a.changed_by::text,a.actor_id::text,'Not recorded') actor_name,
   coalesce(a.changed_at,a.occurred_at) event_at,
   coalesce(a.new_data->>'source',a.old_data->>'source','Not recorded') source,
   coalesce(a.reason,a.new_data->>'reason',a.old_data->>'reason') event_reason
  from public.transport_trip_audit a left join public.user_profiles u on u.id=coalesce(a.changed_by,a.actor_id)
  where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc and upper(btrim(a.trip_no))=n
 ), page as (select * from filtered order by event_at asc nulls first,id asc limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)),
 ids as (select distinct v.value#>>'{}' id from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.old_data)='object' then a.old_data else '{}'::jsonb end) v
  union select distinct v.value#>>'{}' from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.new_data)='object' then a.new_data else '{}'::jsonb end) v),
 labels as (
  select id::text id,name label from public.customers where company_id=c and id::text in (select id from ids)
  union all select id::text,name from public.suppliers where company_id=c and id::text in (select id from ids)
  union all select id::text,driver_name from public.transport_drivers where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,vehicle_no from public.transport_vehicles where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.transport_locations where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.transport_truck_types where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.employees where company_id=c and id::text in (select id from ids)
 )
 select jsonb_build_object('trip_no',n,'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.event_at asc nulls first,p.id) from page p),'[]'::jsonb),
 'count',(select count(*) from filtered),'labels',coalesce((select jsonb_object_agg(id,label) from labels),'{}'::jsonb),
 'deleted',exists(select 1 from filtered) and not exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and upper(btrim(t.trip_no))=n),
 'snapshot',coalesce((select coalesce(nullif(a.new_data,'{}'),a.old_data) from filtered a where coalesce(a.new_data,a.old_data) ? 'trip_no' order by a.event_at desc,a.id desc limit 1),'{}'::jsonb)) into answer;
 return answer;
end $$;

create or replace function public.transport_post_trip_expense(
  p_trip_id uuid,
  p_expense_date date,
  p_expense_type text,
  p_amount numeric,
  p_payment_method text,
  p_source_reference text,
  p_description text default null,
  p_supplier_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_company uuid:=public.current_company_id();
  v_unit uuid:=public.current_business_unit_id();
  v_location uuid:=public.current_operating_location_id();
  v_user uuid:=public.legacy_data_user_id();
  v_method text:=lower(btrim(coalesce(p_payment_method,'')));
  v_ref text:=btrim(coalesce(p_source_reference,''));
  v_trip_no text; v_expense_id uuid; v_entry public.journal_entries%rowtype;
  v_expense_account uuid; v_credit_account uuid; v_supplier_name text;
begin
  perform public.assert_module_permission('transport','edit');
  perform public.assert_module_permission('accounting','create');
  perform public.assert_module_permission('accounting','post');
  if v_company is null or v_unit is null or v_location is null then raise exception 'Active company, business unit and branch/location are required.'; end if;
  if p_expense_date is null then raise exception 'Expense date is required.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Expense amount must be greater than zero.'; end if;
  if nullif(btrim(coalesce(p_expense_type,'')),'') is null then raise exception 'Expense type is required.'; end if;
  if v_ref='' then raise exception 'Source reference is required.'; end if;
  if v_method not in ('cash','bank','payable') then raise exception 'Payment method must be Cash, Bank or Payable.'; end if;

  select t.trip_no into v_trip_no from public.transport_trips t
   where t.id=p_trip_id and t.company_id=v_company and t.business_unit_id=v_unit and t.operating_location_id=v_location for update;
  if not found then raise exception 'Transport trip not found in the active company/business unit.'; end if;

  if exists(select 1 from public.transport_trip_expenses e where e.company_id=v_company and e.business_unit_id=v_unit and lower(btrim(e.source_reference))=lower(v_ref)) then
    raise exception 'Transport expense source reference already exists: %',v_ref;
  end if;

  if not exists(select 1 from public.transport_vehicle_expense_types et where et.company_id=v_company and et.business_unit_id=v_unit and et.is_active=true and lower(btrim(et.name))=lower(btrim(p_expense_type))) then
    raise exception 'Active Transport expense type not found: %',p_expense_type;
  end if;

  select am.account_id into v_expense_account from public.account_mappings am join public.chart_of_accounts c on c.id=am.account_id and c.company_id=v_company
   where am.user_id=v_user and am.company_id=v_company and am.mapping_key='transport_expense' and c.is_active and not c.is_group and c.type='expense' limit 1;
  if v_expense_account is null then raise exception 'Transport Expense mapping is missing or invalid.'; end if;

  if v_method='payable' then
    if p_supplier_id is null then raise exception 'Supplier is required for Payable expenses.'; end if;
    select s.name,s.account_id into v_supplier_name,v_credit_account from public.suppliers s where s.id=p_supplier_id and s.company_id=v_company;
    if not found then raise exception 'Supplier not found in the active company.'; end if;
    if v_credit_account is distinct from (select am.account_id from public.account_mappings am where am.user_id=v_user and am.company_id=v_company and am.mapping_key='accounts_payable' limit 1) then raise exception 'Supplier/AP mapping mismatch.'; end if;
  else
    select am.account_id into v_credit_account from public.account_mappings am join public.chart_of_accounts c on c.id=am.account_id and c.company_id=v_company
     where am.user_id=v_user and am.company_id=v_company and am.mapping_key=v_method and c.is_active and not c.is_group and c.type='asset' limit 1;
    if v_credit_account is null then raise exception '% mapping is missing or invalid.',initcap(v_method); end if;
  end if;

  v_entry:=public.create_manual_journal_entry(p_expense_date,concat('Transport ',p_expense_type,' expense · Trip ',v_trip_no,' · ',v_ref));
  update public.journal_entries set source_module='transport',source_document_type='trip_expense' where id=v_entry.id;

  insert into public.transport_trip_expenses(company_id,business_unit_id,operating_location_id,trip_id,expense_date,expense_type,amount,description,journal_entry_id,created_by,source_reference)
  values(v_company,v_unit,v_location,p_trip_id,p_expense_date,btrim(p_expense_type),round(p_amount,2),nullif(btrim(coalesce(p_description,'')),''),v_entry.id,auth.uid(),v_ref)
  returning id into v_expense_id;

  update public.journal_entries set source_document_id=v_expense_id where id=v_entry.id;

  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit,base_debit,base_credit,party_type,party_id,party_name)
  select v_user,v_company,v_unit,v_location,v_entry.id,c.name,c.id,round(p_amount,2),0,round(p_amount,2),0,null,null,null from public.chart_of_accounts c where c.id=v_expense_account;
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit,base_debit,base_credit,party_type,party_id,party_name)
  select v_user,v_company,v_unit,v_location,v_entry.id,c.name,c.id,0,round(p_amount,2),0,round(p_amount,2),
    case when v_method='payable' then 'supplier' end,case when v_method='payable' then p_supplier_id end,case when v_method='payable' then v_supplier_name end
  from public.chart_of_accounts c where c.id=v_credit_account;

  perform public.post_journal_entry(v_entry.id);
  return jsonb_build_object('success',true,'expense_id',v_expense_id,'journal_entry_id',v_entry.id,'trip_no',v_trip_no,'source_reference',v_ref,'status','posted');
end$$;

create or replace function public.transport_post_trip_expense_batch(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_row jsonb; v_result jsonb; v_count integer:=0; v_seen text[]:=array[]::text[];
  v_ref text; v_trip_id uuid; v_supplier_id uuid;
begin
  perform public.assert_module_permission('transport','edit');
  perform public.assert_module_permission('accounting','create');
  perform public.assert_module_permission('accounting','post');
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Expense rows are required.'; end if;
  if jsonb_array_length(p_rows)>500 then raise exception 'Maximum 500 expense rows per file.'; end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_ref:=lower(btrim(coalesce(v_row->>'source_reference','')));
    if v_ref='' then raise exception 'Source reference is required.'; end if;
    if v_ref=any(v_seen) then raise exception 'Duplicate Source Reference in file: %',v_row->>'source_reference'; end if;
    v_seen:=array_append(v_seen,v_ref);
    select t.id into v_trip_id from public.transport_trips t
      where t.company_id=public.current_company_id() and t.business_unit_id=public.current_business_unit_id()
        and t.operating_location_id=public.current_operating_location_id()
        and lower(btrim(t.trip_no))=lower(btrim(coalesce(v_row->>'trip_no',''))) limit 1;
    if v_trip_id is null then raise exception 'Trip not found: %',v_row->>'trip_no'; end if;
    v_supplier_id:=null;
    if nullif(btrim(coalesce(v_row->>'supplier','')),'') is not null then
      select s.id into v_supplier_id from public.suppliers s
       where s.company_id=public.current_company_id() and lower(btrim(s.name))=lower(btrim(v_row->>'supplier')) limit 1;
      if v_supplier_id is null then raise exception 'Supplier not found: %',v_row->>'supplier'; end if;
    end if;
    v_result:=public.transport_post_trip_expense(
      v_trip_id,(v_row->>'expense_date')::date,v_row->>'expense_type',(v_row->>'amount')::numeric,
      v_row->>'payment_method',v_row->>'source_reference',nullif(btrim(coalesce(v_row->>'description','')),''),v_supplier_id
    );
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('success',true,'posted',v_count);
end$$;

create or replace function public.transport_financial_register_page(p_limit integer default 1000,p_offset integer default 0)
returns setof public.transport_financial_register language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if c is null or b is null or loc is null then raise exception 'Active company, business unit and branch required';end if;
 if not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if;
 return query select r.* from public.transport_financial_register r join public.transport_trips t on t.id=r.id
 where r.company_id=c and r.business_unit_id=b and t.operating_location_id=loc
 order by r.trip_date desc,r.trip_no desc limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0);
end $$;

create or replace function public.transport_post_customer_bill_described(
 p_trip_id uuid,p_date date,p_with_tax boolean default false,p_invoice_no text default null,p_description text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;rev uuid;
begin
 t:=public.transport_financial_trip(p_trip_id);
 select am.account_id into rev from public.account_mappings am join public.chart_of_accounts a on a.id=am.account_id
 where am.company_id=t.company_id and am.mapping_key='service_revenue' and a.company_id=t.company_id and a.type='revenue' and a.is_active and not a.is_group
 order by (am.user_id=public.legacy_data_user_id()) desc,am.user_id limit 1;
 if rev is null then raise exception 'Service Revenue mapping is missing or invalid';end if;
 return public.transport_post_customer_bill_accounted(p_trip_id,p_date,rev,p_with_tax,p_invoice_no,p_description);
end $$;

create or replace function public.transport_post_customer_bill_grouped(
  p_trip_ids uuid[],
  p_date date,
  p_revenue_account_id uuid,
  p_with_tax boolean default false,
  p_invoice_no text default null,
  p_descriptions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  v_expected int;
  v_count int;
  v_party_count int;
  v_sale_type_count int;
  v_null_party boolean;
  v_null_sale_type boolean;
  v_customer uuid;
  v_sale_type text;
  v_base_currency text;
  v_tax numeric;
  v_number text;
  v_order uuid;
  v_doc uuid;
  v_post jsonb;
  v_expected_net numeric:=0;
  v_base numeric;
  v_charge numeric;
  v_line_vat numeric;
  v_description text;
  t public.transport_trips%rowtype;
  r record;
begin
  if p_trip_ids is null or cardinality(p_trip_ids)=0 or p_date is null then
    raise exception 'Select one or more Transport trips and an invoice date';
  end if;
  if cardinality(p_trip_ids)>500 then
    raise exception 'A Transport invoice can include at most 500 trips';
  end if;
  if loc is null then
    raise exception 'Active operating location required';
  end if;

  select count(distinct x) into v_expected from unnest(p_trip_ids) x;
  if v_expected<>cardinality(p_trip_ids) then
    raise exception 'Duplicate Trip selection is not allowed';
  end if;

  perform public.transport_finance_assert('billing');
  perform public.assert_module_permission('sales','create');

  if p_revenue_account_id is null
     or not exists(
       select 1 from public.chart_of_accounts a
       where a.id=p_revenue_account_id
         and a.company_id=c
         and a.type='revenue'
         and a.is_active
         and not a.is_group
     )
  then
    raise exception 'Active same-company revenue account required';
  end if;

  perform 1
  from public.transport_trips t0
  where t0.id=any(p_trip_ids)
    and t0.company_id=c
    and t0.business_unit_id=b
  order by t0.id
  for update;

  select count(*),
         count(distinct customer_id),
         count(distinct sale_type),
         bool_or(customer_id is null),
         bool_or(sale_type is null),
         (array_agg(customer_id order by id))[1],
         (array_agg(sale_type order by id))[1]
    into v_count,v_party_count,v_sale_type_count,v_null_party,v_null_sale_type,v_customer,v_sale_type
  from public.transport_trips
  where id=any(p_trip_ids)
    and company_id=c
    and business_unit_id=b;

  if v_count<>v_expected then
    raise exception 'All selected trips must belong to the active Company and Business Unit';
  end if;
  if v_null_party or v_party_count<>1 then
    raise exception 'One customer is required per Transport invoice';
  end if;
  if v_null_sale_type or v_sale_type_count<>1 or v_sale_type not in ('cash','credit') then
    raise exception 'Selected trips must use one Cash/Credit sale type per invoice';
  end if;

  select base_currency_code into v_base_currency from public.companies where id=c;
  v_tax:=case when p_with_tax then public.fixed_tax_rate_on(c,'sales',p_date) else 0 end;
  if v_tax is null then raise exception 'Effective fixed VAT rate required'; end if;
  v_number:=public.transport_choose_invoice_number('customer',p_invoice_no);

  for t in
    select *
    from public.transport_trips
    where id=any(p_trip_ids)
      and company_id=c
      and business_unit_id=b
    order by trip_no,id
  loop
    if t.lifecycle_status='cancelled' or t.status='cancelled' then
      raise exception 'Active Transport Trip in current workspace required';
    end if;
    if t.customer_rate_state is distinct from 'finalized'
       or t.customer_rate_snapshot is null
       or t.customer_rate_snapshot is distinct from t.customer_rate
       or t.customer_rate<=0
    then
      raise exception 'Consistent finalized customer rate snapshot required for Trip %',t.trip_no;
    end if;
    if t.sales_order_id is not null
       or exists(
         select 1
         from public.transport_customer_document_trips l
         where l.trip_id=t.id and not l.is_adjustment
       )
    then
      raise exception 'Trip % is already billed',t.trip_no;
    end if;

    v_base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);
    if coalesce(v_base,0)<=0 then
      raise exception 'Positive base customer service amount required for Trip %',t.trip_no;
    end if;

    select coalesce(sum(tc.amount),0)
      into v_charge
    from public.transport_trip_customer_charges tc
    join public.charge_master cm on cm.id=tc.charge_master_id
    where tc.trip_id=t.id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('sales','both');

    if round(v_base+v_charge,2) is distinct from round(t.customer_rate_snapshot,2) then
      raise exception 'Customer base + charges does not reconcile to finalized Trip rate for %',t.trip_no;
    end if;

    v_description:=nullif(btrim(coalesce(p_descriptions->>t.id::text,'')),'');
    if length(coalesce(v_description,''))>2000 then
      raise exception 'Invoice description must be at most 2000 characters for Trip %',t.trip_no;
    end if;
    v_expected_net:=v_expected_net+t.customer_rate_snapshot;
  end loop;

  insert into public.sales_orders(
    user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,
    status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode
  )
  values(
    u,c,b,loc,v_number,v_customer,p_date,'draft',
    case when p_with_tax then 'Tax Invoice' else 'Sale Invoice' end,
    v_tax,v_base_currency,1,'service','Credit'
  )
  returning id into v_order;

  for t in
    select *
    from public.transport_trips
    where id=any(p_trip_ids)
      and company_id=c
      and business_unit_id=b
    order by trip_no,id
  loop
    v_base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);
    v_description:=nullif(btrim(coalesce(p_descriptions->>t.id::text,'')),'');
    insert into public.sales_service_lines(
      company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,
      source_module,source_id,created_by
    )
    values(
      c,b,v_order,
      concat_ws(E'\n',v_description,public.transport_trip_service_description(t.id)),
      round(v_base,2),v_tax,p_revenue_account_id,'transport',t.id,auth.uid()
    );
  end loop;

  insert into public.sales_order_charges(
    order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,
    cost_amount,cost_account_id,company_id,business_unit_id,quantity,rate
  )
  select
    v_order,
    cm.charge_key,
    cm.charge_name,
    round(sum(tc.amount),2),
    case when p_with_tax and cm.tax_applicable then v_tax else 0 end,
    cm.revenue_account_id,
    'recovery',
    0,
    cm.cost_account_id,
    c,b,
    case when cm.is_fixed then count(*)::numeric else 1 end,
    case when cm.is_fixed then cm.default_rate else round(sum(tc.amount),2) end
  from public.transport_trip_customer_charges tc
  join public.charge_master cm on cm.id=tc.charge_master_id
  where tc.trip_id=any(p_trip_ids)
    and tc.company_id=c
    and tc.business_unit_id=b
    and cm.company_id=c
    and cm.is_active
    and cm.applies_to in ('sales','both')
  group by cm.id,cm.charge_key,cm.charge_name,cm.revenue_account_id,cm.cost_account_id,
           cm.tax_applicable,cm.is_fixed,cm.default_rate;

  if exists(
    select 1
    from public.sales_order_charges x
    where x.order_id=v_order and x.account_id is null
  ) then
    raise exception 'Every customer charge requires a revenue account mapping';
  end if;

  v_post:=public.post_sales_invoice(v_order);

  if round(coalesce((v_post->>'subtotal_excluding_vat')::numeric,0),2)
     is distinct from round(v_expected_net,2)
  then
    raise exception 'Grouped customer invoice total does not reconcile to selected Trip totals';
  end if;

  insert into public.transport_customer_documents(
    company_id,business_unit_id,operating_location_id,customer_id,document_kind,
    sales_order_id,journal_entry_id,created_by
  )
  values(
    c,b,loc,v_customer,
    case when v_sale_type='cash' then 'cash_hand_bill' else 'credit' end,
    v_order,(v_post->>'journal_entry_id')::uuid,auth.uid()
  )
  returning id into v_doc;

  for t in
    select *
    from public.transport_trips
    where id=any(p_trip_ids)
      and company_id=c
      and business_unit_id=b
    order by trip_no,id
  loop
    v_base:=coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0);
    select
      round(v_base*v_tax/100,2)
      + coalesce(sum(
          case when p_with_tax and cm.tax_applicable
               then round(tc.amount*v_tax/100,2)
               else 0 end
        ),0)
      into v_line_vat
    from public.transport_trip_customer_charges tc
    join public.charge_master cm on cm.id=tc.charge_master_id
    where tc.trip_id=t.id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('sales','both');

    insert into public.transport_customer_document_trips(
      company_id,business_unit_id,operating_location_id,document_id,trip_id,rate_snapshot,vat_snapshot
    )
    values(c,b,loc,v_doc,t.id,t.customer_rate_snapshot,coalesce(v_line_vat,round(v_base*v_tax/100,2)));

    perform public.transport_financial_audit(
      t.id,'customer_bill_posted',
      v_post||jsonb_build_object(
        'transport_document_id',v_doc,
        'sale_type',v_sale_type,
        'revenue_account_id',p_revenue_account_id,
        'grouped_invoice',true,
        'grouped_trip_count',v_expected,
        'invoice_no',v_number
      )
    );
  end loop;

  update public.transport_customer_document_trips l
     set vat_snapshot=round(l.vat_snapshot + (
       coalesce((v_post->>'vat')::numeric,0)
       - coalesce((select sum(x.vat_snapshot) from public.transport_customer_document_trips x where x.document_id=v_doc),0)
     ),2)
   where l.id=(select max(x.id) from public.transport_customer_document_trips x where x.document_id=v_doc)
     and abs(coalesce((v_post->>'vat')::numeric,0)-coalesce((select sum(x.vat_snapshot) from public.transport_customer_document_trips x where x.document_id=v_doc),0))>=0.005;

  update public.transport_supplier_document_rents l
     set vat_snapshot=round(l.vat_snapshot + (
       coalesce((v_post->>'vat')::numeric,0)
       - coalesce((select sum(x.vat_snapshot) from public.transport_supplier_document_rents x where x.document_id=v_doc),0)
     ),2)
   where l.id=(select max(x.id) from public.transport_supplier_document_rents x where x.document_id=v_doc)
     and abs(coalesce((v_post->>'vat')::numeric,0)-coalesce((select sum(x.vat_snapshot) from public.transport_supplier_document_rents x where x.document_id=v_doc),0))>=0.005;

  return v_post||jsonb_build_object(
    'transport_document_id',v_doc,
    'invoice_no',v_number,
    'grouped_invoice',true,
    'trip_count',v_expected,
    'revenue_account_id',p_revenue_account_id
  );
end
$function$;

create or replace function public.transport_post_supplier_bill_grouped(
  p_rent_ids uuid[],
  p_date date,
  p_cost_account_id uuid,
  p_with_tax boolean default false,
  p_reference text default null,
  p_invoice_no text default null,
  p_descriptions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  v_expected int;
  v_count int;
  v_party_count int;
  v_null_party boolean;
  v_supplier uuid;
  v_base_currency text;
  v_tax numeric;
  v_number text;
  v_order uuid;
  v_doc uuid;
  v_post jsonb;
  v_expected_net numeric:=0;
  v_base numeric;
  v_charge numeric;
  v_line_vat numeric;
  v_description text;
  x public.transport_trip_supplier_rents%rowtype;
  t public.transport_trips%rowtype;
begin
  if p_rent_ids is null or cardinality(p_rent_ids)=0 or p_date is null then
    raise exception 'Select one or more finalized supplier rents and an invoice date';
  end if;
  if cardinality(p_rent_ids)>500 then
    raise exception 'A Transport supplier invoice can include at most 500 rent lines';
  end if;
  if loc is null then
    raise exception 'Active operating location required';
  end if;

  select count(distinct x0) into v_expected from unnest(p_rent_ids) x0;
  if v_expected<>cardinality(p_rent_ids) then
    raise exception 'Duplicate supplier rent selection is not allowed';
  end if;

  perform public.transport_finance_assert('rent');
  perform public.assert_module_permission('purchase','create');

  if p_cost_account_id is null
     or not exists(
       select 1 from public.chart_of_accounts a
       where a.id=p_cost_account_id
         and a.company_id=c
         and a.type='expense'
         and a.is_active
         and not a.is_group
     )
  then
    raise exception 'Active same-company expense account required';
  end if;

  perform 1
  from public.transport_trip_supplier_rents r0
  where r0.id=any(p_rent_ids)
    and r0.company_id=c
    and r0.business_unit_id=b
  order by r0.id
  for update;

  select count(*),
         count(distinct supplier_id),
         bool_or(supplier_id is null),
         (array_agg(supplier_id order by id))[1]
    into v_count,v_party_count,v_null_party,v_supplier
  from public.transport_trip_supplier_rents
  where id=any(p_rent_ids)
    and company_id=c
    and business_unit_id=b;

  if v_count<>v_expected then
    raise exception 'All selected supplier rents must belong to the active Company and Business Unit';
  end if;
  if v_null_party or v_party_count<>1 then
    raise exception 'One supplier is required per Transport supplier invoice';
  end if;

  select base_currency_code into v_base_currency from public.companies where id=c;
  v_tax:=case when p_with_tax then public.fixed_tax_rate_on(c,'purchase',p_date) else 0 end;
  if v_tax is null then raise exception 'Effective fixed VAT rate required'; end if;
  v_number:=public.transport_choose_invoice_number('supplier',p_invoice_no);

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);

    if x.state is distinct from 'finalized'
       or x.finalized_amount_snapshot is null
       or x.finalized_amount_snapshot is distinct from x.amount
       or x.finalized_amount_snapshot<=0
    then
      raise exception 'Consistent positive finalized supplier rent snapshot required for Trip %',t.trip_no;
    end if;

    if exists(
      select 1
      from public.transport_supplier_document_rents l
      where l.rent_id=x.id and not l.is_adjustment
    ) then
      raise exception 'Supplier rent for Trip % is already billed',t.trip_no;
    end if;

    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
    if coalesce(v_base,0)<=0 then
      raise exception 'Positive base supplier service amount required for Trip %',t.trip_no;
    end if;

    select coalesce(sum(sc.amount),0)
      into v_charge
    from public.transport_trip_supplier_charges sc
    join public.charge_master cm on cm.id=sc.charge_master_id
    where sc.rent_id=x.id
      and sc.trip_id=x.trip_id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('purchase','both');

    if round(v_base+v_charge,2) is distinct from round(x.finalized_amount_snapshot,2) then
      raise exception 'Supplier base rent + charges does not reconcile to finalized total rent for Trip %',t.trip_no;
    end if;

    v_description:=nullif(btrim(coalesce(p_descriptions->>x.id::text,'')),'');
    if length(coalesce(v_description,''))>2000 then
      raise exception 'Invoice description must be at most 2000 characters for Trip %',t.trip_no;
    end if;

    v_expected_net:=v_expected_net+x.finalized_amount_snapshot;
  end loop;

  insert into public.purchase_orders(
    user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,
    status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,
    supplier_invoice_no,supplier_invoice_date
  )
  values(
    u,c,b,loc,v_number,v_supplier,p_date,'draft',
    case when p_with_tax then 'Tax Invoice' else 'Purchase Invoice' end,
    v_tax,v_base_currency,1,'service',
    coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),
    p_date
  )
  returning id into v_order;

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);
    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
    v_description:=nullif(btrim(coalesce(p_descriptions->>x.id::text,'')),'');
    insert into public.purchase_service_lines(
      company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,
      source_module,source_id,created_by
    )
    values(
      c,b,v_order,
      concat_ws(E'\n',v_description,public.transport_trip_service_description(t.id)||' · Supplier rent'),
      round(v_base,2),v_tax,p_cost_account_id,'transport',t.id,auth.uid()
    );
  end loop;

  insert into public.purchase_order_charges(
    user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,
    treatment,cost_account_id,quantity,rate
  )
  select
    u,c,b,v_order,
    cm.charge_key,
    cm.charge_name,
    round(sum(sc.amount),2),
    case when p_with_tax and cm.tax_applicable then v_tax else 0 end,
    coalesce(cm.purchase_treatment,'expense'),
    cm.cost_account_id,
    case when cm.is_fixed then count(*)::numeric else 1 end,
    case when cm.is_fixed then cm.default_rate else round(sum(sc.amount),2) end
  from public.transport_trip_supplier_charges sc
  join public.charge_master cm on cm.id=sc.charge_master_id
  where sc.rent_id=any(p_rent_ids)
    and sc.company_id=c
    and sc.business_unit_id=b
    and cm.company_id=c
    and cm.is_active
    and cm.applies_to in ('purchase','both')
  group by cm.id,cm.charge_key,cm.charge_name,cm.tax_applicable,cm.purchase_treatment,
           cm.cost_account_id,cm.is_fixed,cm.default_rate;

  if exists(
    select 1
    from public.purchase_order_charges x0
    where x0.order_id=v_order and x0.cost_account_id is null
  ) then
    raise exception 'Every supplier charge requires a cost account mapping';
  end if;

  v_post:=public.post_purchase_invoice(v_order);

  if round(coalesce((v_post->>'subtotal_excluding_vat')::numeric,0),2)
     is distinct from round(v_expected_net,2)
  then
    raise exception 'Grouped supplier invoice total does not reconcile to selected rent totals';
  end if;

  insert into public.transport_supplier_documents(
    company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by
  )
  values(c,b,loc,v_supplier,v_order,(v_post->>'journal_entry_id')::uuid,auth.uid())
  returning id into v_doc;

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);
    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);

    select
      round(v_base*v_tax/100,2)
      + coalesce(sum(
          case when p_with_tax and cm.tax_applicable
               then round(sc.amount*v_tax/100,2)
               else 0 end
        ),0)
      into v_line_vat
    from public.transport_trip_supplier_charges sc
    join public.charge_master cm on cm.id=sc.charge_master_id
    where sc.rent_id=x.id
      and sc.trip_id=x.trip_id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('purchase','both');

    insert into public.transport_supplier_document_rents(
      company_id,business_unit_id,operating_location_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot
    )
    values(c,b,loc,v_doc,x.id,t.id,x.finalized_amount_snapshot,coalesce(v_line_vat,round(v_base*v_tax/100,2)));

    perform public.transport_financial_audit(
      t.id,'supplier_bill_posted',
      v_post||jsonb_build_object(
        'rent_id',x.id,
        'transport_document_id',v_doc,
        'grouped_invoice',true,
        'grouped_rent_count',v_expected,
        'invoice_no',v_number
      )
    );
  end loop;

  return v_post||jsonb_build_object(
    'transport_document_id',v_doc,
    'invoice_no',v_number,
    'grouped_invoice',true,
    'rent_count',v_expected,
    'cost_account_id',p_cost_account_id
  );
end
$function$;

create or replace function public.transport_post_supplier_bill_grouped(
  p_rent_ids uuid[],
  p_date date,
  p_cost_account_id uuid,
  p_with_tax boolean default false,
  p_reference text default null,
  p_invoice_no text default null,
  p_descriptions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  v_expected int;
  v_count int;
  v_party_count int;
  v_null_party boolean;
  v_supplier uuid;
  v_base_currency text;
  v_tax numeric;
  v_number text;
  v_order uuid;
  v_doc uuid;
  v_post jsonb;
  v_expected_net numeric:=0;
  v_base numeric;
  v_charge numeric;
  v_line_vat numeric;
  v_description text;
  x public.transport_trip_supplier_rents%rowtype;
  t public.transport_trips%rowtype;
begin
  if p_rent_ids is null or cardinality(p_rent_ids)=0 or p_date is null then
    raise exception 'Select one or more finalized supplier rents and an invoice date';
  end if;
  if cardinality(p_rent_ids)>500 then
    raise exception 'A Transport supplier invoice can include at most 500 rent lines';
  end if;
  if loc is null then
    raise exception 'Active operating location required';
  end if;

  select count(distinct x0) into v_expected from unnest(p_rent_ids) x0;
  if v_expected<>cardinality(p_rent_ids) then
    raise exception 'Duplicate supplier rent selection is not allowed';
  end if;

  perform public.transport_finance_assert('rent');
  perform public.assert_module_permission('purchase','create');

  if p_cost_account_id is null
     or not exists(
       select 1 from public.chart_of_accounts a
       where a.id=p_cost_account_id
         and a.company_id=c
         and a.type='expense'
         and a.is_active
         and not a.is_group
     )
  then
    raise exception 'Active same-company expense account required';
  end if;

  perform 1
  from public.transport_trip_supplier_rents r0
  where r0.id=any(p_rent_ids)
    and r0.company_id=c
    and r0.business_unit_id=b
  order by r0.id
  for update;

  select count(*),
         count(distinct supplier_id),
         bool_or(supplier_id is null),
         (array_agg(supplier_id order by id))[1]
    into v_count,v_party_count,v_null_party,v_supplier
  from public.transport_trip_supplier_rents
  where id=any(p_rent_ids)
    and company_id=c
    and business_unit_id=b;

  if v_count<>v_expected then
    raise exception 'All selected supplier rents must belong to the active Company and Business Unit';
  end if;
  if v_null_party or v_party_count<>1 then
    raise exception 'One supplier is required per Transport supplier invoice';
  end if;

  select base_currency_code into v_base_currency from public.companies where id=c;
  v_tax:=case when p_with_tax then public.fixed_tax_rate_on(c,'purchase',p_date) else 0 end;
  if v_tax is null then raise exception 'Effective fixed VAT rate required'; end if;
  v_number:=public.transport_choose_invoice_number('supplier',p_invoice_no);

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);

    if x.state is distinct from 'finalized'
       or x.finalized_amount_snapshot is null
       or x.finalized_amount_snapshot is distinct from x.amount
       or x.finalized_amount_snapshot<=0
    then
      raise exception 'Consistent positive finalized supplier rent snapshot required for Trip %',t.trip_no;
    end if;

    if exists(
      select 1
      from public.transport_supplier_document_rents l
      where l.rent_id=x.id and not l.is_adjustment
    ) then
      raise exception 'Supplier rent for Trip % is already billed',t.trip_no;
    end if;

    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
    if coalesce(v_base,0)<=0 then
      raise exception 'Positive base supplier service amount required for Trip %',t.trip_no;
    end if;

    select coalesce(sum(sc.amount),0)
      into v_charge
    from public.transport_trip_supplier_charges sc
    join public.charge_master cm on cm.id=sc.charge_master_id
    where sc.rent_id=x.id
      and sc.trip_id=x.trip_id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('purchase','both');

    if round(v_base+v_charge,2) is distinct from round(x.finalized_amount_snapshot,2) then
      raise exception 'Supplier base rent + charges does not reconcile to finalized total rent for Trip %',t.trip_no;
    end if;

    v_description:=nullif(btrim(coalesce(p_descriptions->>x.id::text,'')),'');
    if length(coalesce(v_description,''))>2000 then
      raise exception 'Invoice description must be at most 2000 characters for Trip %',t.trip_no;
    end if;

    v_expected_net:=v_expected_net+x.finalized_amount_snapshot;
  end loop;

  insert into public.purchase_orders(
    user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,
    status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,
    supplier_invoice_no,supplier_invoice_date
  )
  values(
    u,c,b,loc,v_number,v_supplier,p_date,'draft',
    case when p_with_tax then 'Tax Invoice' else 'Purchase Invoice' end,
    v_tax,v_base_currency,1,'service',
    coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),
    p_date
  )
  returning id into v_order;

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);
    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
    v_description:=nullif(btrim(coalesce(p_descriptions->>x.id::text,'')),'');
    insert into public.purchase_service_lines(
      company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,
      source_module,source_id,created_by
    )
    values(
      c,b,v_order,
      concat_ws(E'\n',v_description,public.transport_trip_service_description(t.id)||' · Supplier rent'),
      round(v_base,2),v_tax,p_cost_account_id,'transport',t.id,auth.uid()
    );
  end loop;

  insert into public.purchase_order_charges(
    user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,
    treatment,cost_account_id,quantity,rate
  )
  select
    u,c,b,v_order,
    cm.charge_key,
    cm.charge_name,
    round(sum(sc.amount),2),
    case when p_with_tax and cm.tax_applicable then v_tax else 0 end,
    coalesce(cm.purchase_treatment,'expense'),
    cm.cost_account_id,
    case when cm.is_fixed then count(*)::numeric else 1 end,
    case when cm.is_fixed then cm.default_rate else round(sum(sc.amount),2) end
  from public.transport_trip_supplier_charges sc
  join public.charge_master cm on cm.id=sc.charge_master_id
  where sc.rent_id=any(p_rent_ids)
    and sc.company_id=c
    and sc.business_unit_id=b
    and cm.company_id=c
    and cm.is_active
    and cm.applies_to in ('purchase','both')
  group by cm.id,cm.charge_key,cm.charge_name,cm.tax_applicable,cm.purchase_treatment,
           cm.cost_account_id,cm.is_fixed,cm.default_rate;

  if exists(
    select 1
    from public.purchase_order_charges x0
    where x0.order_id=v_order and x0.cost_account_id is null
  ) then
    raise exception 'Every supplier charge requires a cost account mapping';
  end if;

  v_post:=public.post_purchase_invoice(v_order);

  if round(coalesce((v_post->>'subtotal_excluding_vat')::numeric,0),2)
     is distinct from round(v_expected_net,2)
  then
    raise exception 'Grouped supplier invoice total does not reconcile to selected rent totals';
  end if;

  insert into public.transport_supplier_documents(
    company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by
  )
  values(c,b,loc,v_supplier,v_order,(v_post->>'journal_entry_id')::uuid,auth.uid())
  returning id into v_doc;

  for x in
    select *
    from public.transport_trip_supplier_rents
    where id=any(p_rent_ids)
      and company_id=c
      and business_unit_id=b
    order by created_at,id
  loop
    t:=public.transport_financial_trip(x.trip_id);
    v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);

    select
      round(v_base*v_tax/100,2)
      + coalesce(sum(
          case when p_with_tax and cm.tax_applicable
               then round(sc.amount*v_tax/100,2)
               else 0 end
        ),0)
      into v_line_vat
    from public.transport_trip_supplier_charges sc
    join public.charge_master cm on cm.id=sc.charge_master_id
    where sc.rent_id=x.id
      and sc.trip_id=x.trip_id
      and cm.company_id=c
      and cm.is_active
      and cm.applies_to in ('purchase','both');

    insert into public.transport_supplier_document_rents(
      company_id,business_unit_id,operating_location_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot
    )
    values(c,b,loc,v_doc,x.id,t.id,x.finalized_amount_snapshot,coalesce(v_line_vat,round(v_base*v_tax/100,2)));

    perform public.transport_financial_audit(
      t.id,'supplier_bill_posted',
      v_post||jsonb_build_object(
        'rent_id',x.id,
        'transport_document_id',v_doc,
        'grouped_invoice',true,
        'grouped_rent_count',v_expected,
        'invoice_no',v_number
      )
    );
  end loop;

  return v_post||jsonb_build_object(
    'transport_document_id',v_doc,
    'invoice_no',v_number,
    'grouped_invoice',true,
    'rent_count',v_expected,
    'cost_account_id',p_cost_account_id
  );
end
$function$;

create or replace function public.accounting_report_balances_scoped(
 p_from date,p_to date,p_exclude_closing boolean default false,p_scope text default 'branch'
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required';end if;
 if p_to is null or (p_from is not null and p_from>p_to) then raise exception 'Valid report dates required';end if;
 if p_scope not in ('company','business_unit','branch') then raise exception 'Report scope must be Company, Business Unit or Branch';end if;
 if p_scope in ('business_unit','branch') and b is null then raise exception 'Active Business Unit required';end if;
 if p_scope='branch' and loc is null then raise exception 'Active branch required';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into answer from (
  select l.account_id,case when p_from is not null and l.entry_date<p_from then p_from-1 else coalesce(p_from,p_to) end entry_date,sum(l.debit) debit,sum(l.credit) credit
  from public.ledgers l join public.journal_entries j on j.id=l.journal_entry_id
  where l.company_id=c and j.company_id=c and l.entry_date<=p_to and j.status='posted'
   and (p_scope='company' or l.business_unit_id=b) and (p_scope<>'branch' or l.operating_location_id=loc)
   and (not p_exclude_closing or ((p_from is null or l.entry_date>=p_from) and j.trans_type is distinct from 'Year End Closing' and j.fiscal_year_closure_id is null))
  group by l.account_id,case when p_from is not null and l.entry_date<p_from then p_from-1 else coalesce(p_from,p_to) end
 ) q;return answer;
end $$;

create or replace function public.accounting_cash_flow_report_scoped(p_from date,p_to date,p_scope text default 'branch')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Valid reporting period required';end if;
 if p_scope not in ('company','business_unit','branch') then raise exception 'Report scope must be Company, Business Unit or Branch';end if;
 if p_scope in ('business_unit','branch') and b is null then raise exception 'Active Business Unit required';end if;
 if p_scope='branch' and loc is null then raise exception 'Active branch required';end if;
 with account_text as materialized (
  select a.*,regexp_replace(lower(coalesce(a.detail_type,'')),'[^a-z0-9]','','g') detail,
  regexp_replace(lower(concat_ws(' ',a.detail_type,a.parent_head)),'[^a-z0-9]','','g') classification
  from public.chart_of_accounts a where a.company_id=c and not a.is_group
 ),accounts as materialized (
  select a.*,a.type='asset' and a.detail in ('cashonhand','cashandcashequivalents','cash','bank','bankaccount','cashandcashequivalent') is_cash,
  case when a.type='equity' or (a.type='liability' and a.classification~'(loan|borrowing|longtermdebt|shorttermdebt|noncurrentliabilit)') then 'financing'
  when a.type='asset' and a.classification~'(fixedasset|noncurrentasset|propertyplant|machinery|equipment|landandbuilding|investment|loansreceivable|intangible)' then 'investing'
  when a.type in ('revenue','income','expense') or (a.type='asset' and a.classification~'(receivable|inventory|currentasset|inputvat|inputtax|prepaid)')
   or (a.type='liability' and a.classification~'(payable|currentliabilit|outputvat|outputtax|creditcard|accrued)') then 'operating' else 'unclassified' end category
  from account_text a
 ),posted as materialized (
  select l.journal_entry_id,l.entry_date,l.debit-l.credit movement,a.is_cash,a.category
  from public.ledgers l join public.journal_entries j on j.id=l.journal_entry_id join accounts a on a.id=l.account_id
  where l.company_id=c and j.company_id=c and j.status='posted' and l.entry_date<=p_to
   and (p_scope='company' or l.business_unit_id=b) and (p_scope<>'branch' or l.operating_location_id=loc)
 ),vouchers as (
  select journal_entry_id,sum(movement) filter(where is_cash) cash_movement,array_agg(distinct category) filter(where not is_cash and abs(movement)>=0.005) categories
  from posted where entry_date>=p_from group by journal_entry_id
 ),classified as (
  select cash_movement,case when cardinality(categories)=1 then categories[1] else 'unclassified' end category from vouchers where abs(coalesce(cash_movement,0))>=0.005
 ),activity as (
  select category,count(*) vouchers,sum(cash_movement) amount from classified group by category
 ),balances as (
  select coalesce(sum(movement) filter(where is_cash and entry_date<p_from),0) opening,coalesce(sum(movement) filter(where is_cash),0) closing from posted
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(activity) order by category) from activity),'[]'::jsonb),
 'opening',(select opening from balances),'closing',(select closing from balances),'movement',(select closing-opening from balances),
 'difference',(select closing-opening from balances)-coalesce((select sum(amount) from activity),0),'scope',p_scope) into answer;
 return answer;
end $$;

revoke all on function public.accounting_report_balances_scoped(date,date,boolean,text) from public,anon;
grant execute on function public.accounting_report_balances_scoped(date,date,boolean,text) to authenticated;
revoke all on function public.accounting_cash_flow_report_scoped(date,date,text) from public,anon;
grant execute on function public.accounting_cash_flow_report_scoped(date,date,text) to authenticated;
notify pgrst,'reload schema';
commit;