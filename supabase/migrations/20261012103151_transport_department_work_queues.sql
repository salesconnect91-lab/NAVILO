-- Read-only, bounded department queues. The full Transport Register remains unchanged.
-- No trip, invoice, supplier rent, payment or historical evidence is modified.
create or replace function public.transport_work_queue(
  p_desk text default 'operations',
  p_page integer default 0,
  p_search text default ''
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
  result jsonb;
  needle text := lower(btrim(coalesce(p_search,'')));
begin
  if auth.uid() is null or c is null or b is null or loc is null
     or not public.has_module_permission(c,'transport','view') then
    raise exception 'Transport view permission and active Company/Business Unit/Location required';
  end if;
  if p_desk not in ('operations','billing','supplier','payments','ppr')
     or p_page is null or p_page < 0 or p_page > 1000
     or length(needle) > 80 then
    raise exception 'Invalid Transport work queue request';
  end if;
  if p_desk='billing' and not public.transport_financial_read_allowed('customer') then
    raise exception 'Customer financial view permission required';
  end if;
  if p_desk='supplier' and not public.transport_financial_read_allowed('supplier') then
    raise exception 'Supplier financial view permission required';
  end if;
  if p_desk='payments' and not (
    public.transport_financial_read_allowed('customer') or
    public.transport_financial_read_allowed('supplier')
  ) then
    raise exception 'Transport financial view permission required';
  end if;

  -- Scope, sort and page BEFORE joining names/snapshots. No ledger or
  -- invoice joins, no count(*) of the entire historical register.
  with picked as materialized (
    select t.id,t.trip_no,t.trip_date,t.po_do_job_no,t.customer_id,
      t.customer_name_snapshot,t.from_location,t.to_location,t.driver_id,
      t.vehicle_id,t.truck_type,t.ppr_status,t.ppr_received_date,
      t.ppr_received_by_name,t.customer_rate_status,t.supplier_rent_status,
      t.trip_status,t.company_id,t.business_unit_id,t.operating_location_id
    from public.transport_trips t
    where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
      and (p_desk <> 'ppr' or t.ppr_status is distinct from 'received')
      and (p_desk <> 'billing' or t.customer_rate_status = 'pending')
      and (p_desk <> 'supplier' or t.supplier_rent_status = 'pending')
      and (needle='' or lower(t.trip_no) like needle||'%' or lower(coalesce(t.po_do_job_no,'')) like needle||'%')
    order by t.trip_date desc,t.trip_no desc
    limit 51 offset (p_page*50)
  ), detailed as (
    select t.*,coalesce(cu.name,t.customer_name_snapshot,'') as customer_name,
      coalesce(d.driver_name,hi.driver_name_snapshot,'') as driver_name,
      coalesce(v.vehicle_no,hi.vehicle_no_snapshot,'') as vehicle_no
    from picked t
    left join public.customers cu on cu.id=t.customer_id
    left join public.transport_drivers d on d.id=t.driver_id
    left join public.transport_vehicles v on v.id=t.vehicle_id
    left join public.transport_historical_trip_identity hi
      on hi.trip_id=t.id and hi.company_id=t.company_id
      and hi.business_unit_id=t.business_unit_id
      and hi.operating_location_id=t.operating_location_id
  )
  select jsonb_build_object(
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',x.id,'trip_no',x.trip_no,'trip_date',x.trip_date,
        'job_no',x.po_do_job_no,'customer',x.customer_name,
        'driver',x.driver_name,'vehicle',x.vehicle_no,
        'truck_type',x.truck_type,'from',x.from_location,'to',x.to_location,
        'ppr_status',x.ppr_status,'ppr_received_date',x.ppr_received_date,
        'ppr_received_by',x.ppr_received_by_name,
        'customer_rate_status',x.customer_rate_status,
        'supplier_rent_status',x.supplier_rent_status,
        'trip_status',x.trip_status
      ) order by x.trip_date desc,x.trip_no desc)
      from (select * from detailed order by trip_date desc,trip_no desc limit 50) x
    ),'[]'::jsonb),
    'has_more',(select count(*)>50 from picked),
    'page',p_page,'desk',p_desk
  ) into result;
  return result;
end
$$;
revoke all on function public.transport_work_queue(text,integer,text) from public, anon;
grant execute on function public.transport_work_queue(text,integer,text) to authenticated, service_role;
