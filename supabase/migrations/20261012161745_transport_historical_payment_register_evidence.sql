-- Historical CSV settlement evidence. No invoice, cash movement or journal is posted.
-- Original Remaining balances are authoritative and stay unchanged.
CREATE TABLE public.transport_historical_payment_files (
 source_hash text PRIMARY KEY CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 business_unit_id uuid NOT NULL REFERENCES public.business_units(id),
 operating_location_id uuid NOT NULL REFERENCES public.operating_locations(id),
 source_name text NOT NULL, source_rows integer NOT NULL,
 excluded_customer_rows integer NOT NULL,
 unallocated_evidence jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.transport_historical_payment_snapshots (
 trip_id uuid PRIMARY KEY REFERENCES public.transport_trips(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 business_unit_id uuid NOT NULL REFERENCES public.business_units(id),
 operating_location_id uuid NOT NULL REFERENCES public.operating_locations(id),
 source_hash text NOT NULL REFERENCES public.transport_historical_payment_files(source_hash),
 received_gross numeric NOT NULL DEFAULT 0 CHECK(received_gross>=0),
 paid_gross numeric NOT NULL DEFAULT 0 CHECK(paid_gross>=0),
 payment_date date, evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transport_historical_payment_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_historical_payment_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transport_historical_payment_files,public.transport_historical_payment_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.transport_historical_payment_files,public.transport_historical_payment_snapshots TO authenticated;
CREATE POLICY historical_payment_files_read ON public.transport_historical_payment_files FOR SELECT TO authenticated USING (
 company_id=(select public.current_company_id()) AND business_unit_id=(select public.current_business_unit_id())
 AND operating_location_id=(select public.current_operating_location_id())
 AND public.has_module_permission(company_id,'transport','view')
 AND public.transport_financial_read_allowed('customer') AND public.transport_financial_read_allowed('supplier'));
CREATE POLICY historical_payment_snapshots_read ON public.transport_historical_payment_snapshots FOR SELECT TO authenticated USING (
 company_id=(select public.current_company_id()) AND business_unit_id=(select public.current_business_unit_id())
 AND operating_location_id=(select public.current_operating_location_id())
 AND public.has_module_permission(company_id,'transport','view')
 AND public.transport_financial_read_allowed('customer') AND public.transport_financial_read_allowed('supplier'));
CREATE FUNCTION public.transport_historical_payment_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Original historical payment evidence is immutable'; END $$;
REVOKE ALL ON FUNCTION public.transport_historical_payment_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER historical_payment_files_immutable BEFORE UPDATE OR DELETE ON public.transport_historical_payment_files FOR EACH ROW EXECUTE FUNCTION public.transport_historical_payment_immutable();
CREATE TRIGGER historical_payment_snapshots_immutable BEFORE UPDATE OR DELETE ON public.transport_historical_payment_snapshots FOR EACH ROW EXECUTE FUNCTION public.transport_historical_payment_immutable();

CREATE OR REPLACE VIEW public.transport_financial_register AS
 SELECT t.id,
    t.company_id,
    t.business_unit_id,
    t.trip_no,
    t.trip_date,
    t.customer_id,
    t.customer_name_snapshot,
    t.vehicle_id,
    t.driver_id,
    t.owner_name_snapshot,
    t.truck_type,
    t.po_do_job_no,
    t.from_location,
    t.to_location,
    t.service_period,
    t.ppr_status,
    t.status,
    t.customer_rate,
    t.driver_pay,
    t.owner_rent,
    t.fuel_cost,
    t.toll_cost,
    t.other_cost,
    t.sales_order_id,
    t.notes,
    t.created_by,
    t.created_at,
    t.updated_at,
    t.truck_type_id,
    t.from_location_id,
    t.to_location_id,
    t.lifecycle_status,
    t.rent_state,
    t.job_status,
    t.ppr_received_by_employee_id,
    t.ppr_received_by_name,
    t.ppr_received_date,
    t.ppr_attachment_path,
    t.customer_rate_state,
    t.customer_rate_source,
    t.customer_rate_reference_id,
    t.customer_rate_snapshot,
    t.customer_rate_finalized_at,
    t.customer_rate_finalized_by,
    t.rent_finalized_at,
    t.rent_finalized_by,
    t.owner_supplier_id,
    t.ownership_id,
    t.trip_status,
    t.customer_rate_status,
    t.supplier_rent,
    t.supplier_rent_status,
    t.ppr_received_by,
    t.updated_by,
    t.sale_type,
    COALESCE(c.name, t.customer_name_snapshot) AS customer_name,
        CASE
            WHEN NOT hm.vehicle_master_id IS DISTINCT FROM t.vehicle_id THEN COALESCE(hi.vehicle_no_snapshot, v.vehicle_no)
            ELSE COALESCE(v.vehicle_no, hi.vehicle_no_snapshot)
        END AS vehicle_no,
    COALESCE(tt.name, t.truck_type, v.truck_type) AS truck_type_name,
        CASE
            WHEN NOT hm.driver_master_id IS DISTINCT FROM t.driver_id THEN COALESCE(hi.driver_name_snapshot, d.driver_name)
            ELSE COALESCE(d.driver_name, hi.driver_name_snapshot)
        END AS driver_name,
    COALESCE(t.owner_name_snapshot, v.owner_name, s.name, hi.owner_name_snapshot) AS owner_name,
    f.financial_status,
    f.customer_documents > 0 AS invoiced,
    f.customer_rate_locked,
    f.supplier_rate_locked,
        CASE
            WHEN f.customer_documents > 0 THEN f.customer_net
            ELSE NULL::numeric
        END AS billed_customer_net,
        CASE WHEN f.customer_documents > 0 THEN f.customer_received_net ELSE hp.received_gross END AS received_from_company,
        CASE WHEN f.customer_documents > 0 THEN f.customer_outstanding_net ELSE (hm.raw_source->>25)::numeric END AS remaining_with_company,
    CASE WHEN f.customer_documents > 0 THEN f.customer_received_gross ELSE coalesce(hp.received_gross,0) END AS customer_received_gross,
    CASE WHEN f.customer_documents > 0 OR hm.trip_id IS NULL THEN f.customer_outstanding_gross ELSE greatest((hm.raw_source->>25)::numeric,0) END AS customer_outstanding_gross,
    CASE WHEN f.customer_documents > 0 OR hm.trip_id IS NULL THEN f.customer_credit_gross ELSE greatest(-(hm.raw_source->>25)::numeric,0) END AS customer_credit_gross,
        CASE
            WHEN f.supplier_rate_locked THEN f.supplier_net
            ELSE NULL::numeric
        END AS billed_supplier_net,
        CASE WHEN f.supplier_rate_locked THEN f.supplier_paid_net ELSE hp.paid_gross END AS supplier_paid_net,
    CASE WHEN f.supplier_rate_locked OR hm.trip_id IS NULL THEN f.supplier_outstanding_gross ELSE greatest((hm.raw_source->>18)::numeric,0) END AS supplier_outstanding_gross,
    CASE WHEN f.supplier_rate_locked OR hm.trip_id IS NULL THEN f.supplier_credit_gross ELSE greatest(-(hm.raw_source->>18)::numeric,0) END AS supplier_credit_gross,
        CASE
            WHEN f.driver_accrued > 0::numeric THEN f.driver_accrued
            ELSE NULL::numeric
        END AS driver_accrued,
    f.driver_paid,
    f.driver_outstanding,
        CASE
            WHEN f.customer_rate_locked OR f.supplier_rate_locked THEN f.supplier_outstanding_gross + f.driver_outstanding
            ELSE NULL::numeric
        END AS remaining_with_us,
    CASE WHEN f.supplier_rate_locked THEN f.supplier_payment_date ELSE hp.payment_date END AS payment_date,
        CASE WHEN f.supplier_rate_locked THEN f.supplier_paid_gross ELSE hp.paid_gross END AS payment_amount,
    f.posted_profit AS trip_profit,
    f.commission_paid_net,
    f.other_cost_net,
    hm.customer_invoice_ref AS historical_customer_invoice_ref,
    hm.supplier_invoice_ref AS historical_supplier_invoice_ref,
    hm.company_owned AS historical_company_owned,
    hm.company_cost_net AS historical_company_cost_net,
    hm.paper_status AS historical_paper_status
   FROM transport_trips t
     JOIN transport_trip_financial_summary f ON f.id = t.id
     LEFT JOIN customers c ON c.id = t.customer_id
     LEFT JOIN transport_vehicles v ON v.id = t.vehicle_id
     LEFT JOIN transport_truck_types tt ON tt.id = t.truck_type_id
     LEFT JOIN transport_drivers d ON d.id = t.driver_id
     LEFT JOIN suppliers s ON s.id = v.supplier_id
     LEFT JOIN user_profiles u ON u.id = t.ppr_received_by
     LEFT JOIN transport_historical_trip_identity hi ON hi.trip_id = t.id AND hi.company_id = t.company_id AND hi.business_unit_id = t.business_unit_id AND hi.operating_location_id = t.operating_location_id
     LEFT JOIN transport_historical_operational_mapping hm ON hm.trip_id = t.id AND hm.company_id = t.company_id AND hm.business_unit_id = t.business_unit_id AND hm.operating_location_id = t.operating_location_id
 LEFT JOIN public.transport_historical_payment_snapshots hp ON hp.trip_id=t.id AND hp.company_id=t.company_id AND hp.business_unit_id=t.business_unit_id AND hp.operating_location_id=t.operating_location_id;
CREATE OR REPLACE FUNCTION public.transport_register_query(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT ''::text, p_direction text DEFAULT 'asc'::text, p_option_key text DEFAULT NULL::text, p_option_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;needs_cells boolean;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid filters';end if;
 if (p_option_key=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or p_sort=any(array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced']) or (coalesce(p_filters->'columns','{}') ?| array['company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced'])) and not cv then raise exception 'Customer financial view permission required';end if;
 if (p_option_key=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner','supplier_invoice_no']) or p_sort=any(array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner','supplier_invoice_no']) or (coalesce(p_filters->'columns','{}') ?| array['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','payment_date','amount','commission','owner','supplier_invoice_no'])) and not sv then raise exception 'Supplier financial view permission required';end if;
 if (p_sort='profit' or p_option_key='profit' or coalesce(p_filters->'columns','{}') ? 'profit') and not (cv and sv) then raise exception 'Both financial view permissions required';end if;
 if p_filters->>'snapshot'='true' and not public.has_module_permission(c,'transport','export') then raise exception 'Transport export permission required';end if;
 -- Unposted operational filter values must not require the expensive
 -- correlated financial/register view. All financial filters, status filters
 -- and full text searches keep the original authoritative path.
 if p_option_key=any(array['trip_no','trip_date','truck_type','job_no','company','driver','plate','from','to','paper_received_by'])
    and btrim(coalesce(p_filters->>'search',''))=''
    and coalesce(jsonb_array_length(p_filters->'statuses'),0)=0
    and not exists(
      select 1 from jsonb_each(coalesce(p_filters->'columns','{}'::jsonb)) f
      where f.key not in ('trip_no','trip_date','truck_type','job_no','company','driver','plate','from','to','paper_received_by')
      and jsonb_array_length(f.value)>0
    )
 then
   with operational as (
     select
      t.trip_date,t.ppr_status,t.from_location,t.to_location,
      coalesce(cu.name,t.customer_name_snapshot) customer_name,
      coalesce(dr.driver_name,hi.driver_name_snapshot) driver_name,
      coalesce(v.vehicle_no,hi.vehicle_no_snapshot) vehicle_no,
      jsonb_build_object(
        'trip_no',coalesce(nullif(t.trip_no,''),'?'),
        'trip_date',coalesce(nullif(to_char(t.trip_date,'DD-Mon-YY'),''),'?'),
        'truck_type',coalesce(nullif(coalesce(tt.name,t.truck_type,v.truck_type),''),'?'),
        'job_no',coalesce(nullif(t.po_do_job_no,''),'?'),
        'company',coalesce(nullif(coalesce(cu.name,t.customer_name_snapshot),''),'?'),
        'driver',coalesce(nullif(coalesce(dr.driver_name,hi.driver_name_snapshot),''),'?'),
        'plate',coalesce(nullif(coalesce(v.vehicle_no,hi.vehicle_no_snapshot),''),'?'),
        'from',coalesce(nullif(t.from_location,''),'?'),
        'to',coalesce(nullif(t.to_location,''),'?'),
        'paper_received_by',coalesce(nullif(case when t.ppr_status='received'
          then coalesce(nullif(t.ppr_received_by_name,''),'—')
            ||coalesce(' · '||to_char(t.ppr_received_date,'DD-Mon-YY'),'')
          else 'Pending' end,''),'?')
      ) cells
     from public.transport_trips t
     left join public.customers cu on cu.id=t.customer_id
     left join public.transport_vehicles v on v.id=t.vehicle_id
     left join public.transport_drivers dr on dr.id=t.driver_id
     left join public.transport_truck_types tt on tt.id=t.truck_type_id
     left join public.transport_historical_trip_identity hi on hi.trip_id=t.id
          and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id
          and hi.operating_location_id=t.operating_location_id
     where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
       and (coalesce(p_filters->>'fromDate','')='' or t.trip_date>=(p_filters->>'fromDate')::date)
       and (coalesce(p_filters->>'toDate','')='' or t.trip_date<=(p_filters->>'toDate')::date)
   ),
   matched as (
      select o.cells->>p_option_key value
      from operational o
      where (coalesce(p_filters->>'customer','')='' or o.customer_name=p_filters->>'customer')
        and (coalesce(p_filters->>'driver','')='' or o.driver_name=p_filters->>'driver')
        and (coalesce(p_filters->>'vehicle','')='' or o.vehicle_no=p_filters->>'vehicle')
        and (coalesce(p_filters->>'from','')='' or o.from_location=p_filters->>'from')
        and (coalesce(p_filters->>'to','')='' or o.to_location=p_filters->>'to')
        and (coalesce(p_filters->>'ppr','')='' or o.ppr_status=p_filters->>'ppr')
        and not exists(
         select 1 from jsonb_each(coalesce(p_filters->'columns','{}'::jsonb)) f
         where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
           and not f.value @> jsonb_build_array(o.cells->>f.key)
        )
        and position(lower(btrim(coalesce(p_option_search,''))) in lower(o.cells->>p_option_key))>0
   )
   select jsonb_build_object('options',coalesce(jsonb_agg(value order by value),'[]'::jsonb))
   into answer from (select distinct value from matched) v;
   return answer;
 end if;

 -- A wholly unlinked, unposted workspace needs operational aggregates for all
 -- Trips, and matching operational details only for the selected page. Any
 -- financial link, charge, search/filter or export keeps the existing path.
 if cv and sv and p_option_key is null and coalesce(p_sort,'') in ('','trip_date')
 and coalesce(p_filters->>'snapshot','false')<>'true'
 and btrim(coalesce(p_filters->>'search',''))=''
 and coalesce(jsonb_array_length(p_filters->'statuses'),0)=0
 and not exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) x where jsonb_array_length(x.value)>0)
 and not exists(select 1 from jsonb_each_text(p_filters) x where x.key in ('fromDate','toDate','customer','driver','vehicle','from','to','ppr') and coalesce(x.value,'')<>'')
 and not exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and t.sales_order_id is not null)
 and not exists(select 1 from public.transport_customer_document_trips x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_supplier_document_rents x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_driver_accrual_attributions x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_driver_payment_attributions x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_service_cost_links x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc)
 and not exists(select 1 from public.transport_trip_customer_charges x where x.company_id=c and x.business_unit_id=b)
 and not exists(select 1 from public.transport_trip_supplier_charges x where x.company_id=c and x.business_unit_id=b)
 then
  with agreed as materialized (
    select trip_id,count(*) n,bool_and(state='finalized') finalized,sum(coalesce(finalized_amount_snapshot,amount)) amount
    from public.transport_trip_supplier_rents where company_id=c and business_unit_id=b group by trip_id
  ), base as materialized (
    select t.id,t.trip_no,t.trip_date,t.ppr_status,
      case when (cv and coalesce(t.customer_rate_state,'pending')='finalized')
        and case when coalesce(a.n,0)>0 then coalesce(a.finalized,false) else sv and coalesce(t.rent_state,'pending')='finalized' end then 'complete'
      when (cv and coalesce(t.customer_rate_state,'pending')='finalized')
        or case when coalesce(a.n,0)>0 then coalesce(a.finalized,false) else sv and coalesce(t.rent_state,'pending')='finalized' end then 'incomplete'
      else 'draft' end status,
      case when cv then coalesce(t.customer_rate,0) else 0 end rate,
      case when sv then coalesce(a.amount,t.supplier_rent,t.owner_rent,0)+coalesce(hm.company_cost_net,0) else 0 end rent,
      case when sv then greatest(coalesce(t.driver_pay,0),0) else 0 end driver_agreed,
      coalesce(hp.received_gross,0) historical_received,coalesce(hp.paid_gross,0) historical_paid,
      coalesce((hm.raw_source->>25)::numeric,0) historical_customer_remaining,
      coalesce((hm.raw_source->>18)::numeric,0) historical_supplier_remaining
    from public.transport_trips t left join agreed a on a.trip_id=t.id
    left join public.transport_historical_operational_mapping hm on hm.trip_id=t.id
      and hm.company_id=t.company_id and hm.business_unit_id=t.business_unit_id and hm.operating_location_id=t.operating_location_id
    left join public.transport_historical_payment_snapshots hp on hp.trip_id=t.id and hp.company_id=t.company_id and hp.business_unit_id=t.business_unit_id and hp.operating_location_id=t.operating_location_id
    where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
  ), selected as materialized (
    select x.*,row_number() over(order by case when p_sort='trip_date' and p_direction='asc' then x.trip_date end asc,
      case when p_sort='trip_date' and p_direction='desc' then x.trip_date end desc,x.trip_date desc,x.trip_no desc,x.id) ordinal
    from base x order by case when p_sort='trip_date' and p_direction='asc' then x.trip_date end asc,
      case when p_sort='trip_date' and p_direction='desc' then x.trip_date end desc,x.trip_date desc,x.trip_no desc,x.id
    limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)
  ), page as (
    select case when cv and sv then to_jsonb(fr) else public._transport_mask_financial_row(to_jsonb(fr),cv,sv) end
      ||jsonb_build_object('status',x.status,'customer_charges',0,'supplier_rent',x.rent,'supplier_charges',0,
        'trip_profit',x.rate-x.rent-x.driver_agreed,
        'invoice_no',case when cv then nullif(fr.historical_customer_invoice_ref,'') end,
        'supplier_invoice_no',case when sv then nullif(fr.historical_supplier_invoice_ref,'') end) item,x.ordinal
    from selected x join lateral (
      select (jsonb_populate_record(null::public.transport_financial_register,
        to_jsonb(t)||jsonb_build_object(
          'customer_name',coalesce(cu.name,t.customer_name_snapshot),
          'vehicle_no',case when hm.vehicle_master_id is not distinct from t.vehicle_id then coalesce(hi.vehicle_no_snapshot,v.vehicle_no) else coalesce(v.vehicle_no,hi.vehicle_no_snapshot) end,
          'truck_type_name',coalesce(tt.name,t.truck_type,v.truck_type),
          'driver_name',case when hm.driver_master_id is not distinct from t.driver_id then coalesce(hi.driver_name_snapshot,d.driver_name) else coalesce(d.driver_name,hi.driver_name_snapshot) end,
          'owner_name',coalesce(t.owner_name_snapshot,v.owner_name,s.name,hi.owner_name_snapshot),
          'financial_status',case when t.trip_status='cancelled' then 'Cancelled' when t.trip_status='draft' then 'Draft'
            when t.customer_rate>0 and (t.owner_rent>0 or exists(select 1 from agreed a where a.trip_id=t.id)) then 'Complete' else 'Not Complete' end,
          'invoiced',false,'customer_rate_locked',false,'supplier_rate_locked',false,
          'billed_customer_net',null,'received_from_company',x.historical_received,'remaining_with_company',x.historical_customer_remaining,
          'customer_received_gross',x.historical_received,'customer_outstanding_gross',greatest(x.historical_customer_remaining,0),'customer_credit_gross',greatest(-x.historical_customer_remaining,0),
          'billed_supplier_net',null,'supplier_paid_net',x.historical_paid,'supplier_outstanding_gross',greatest(x.historical_supplier_remaining,0),'supplier_credit_gross',greatest(-x.historical_supplier_remaining,0),
          'driver_accrued',null,'driver_paid',0,'driver_outstanding',greatest(coalesce(t.driver_pay,0),0),
          'remaining_with_us',x.historical_supplier_remaining,'payment_date',(select hp.payment_date from public.transport_historical_payment_snapshots hp where hp.trip_id=t.id and hp.company_id=t.company_id and hp.business_unit_id=t.business_unit_id and hp.operating_location_id=t.operating_location_id),'payment_amount',x.historical_paid,'trip_profit',null,
          'commission_paid_net',0,'other_cost_net',0,
          'historical_customer_invoice_ref',hm.customer_invoice_ref,'historical_supplier_invoice_ref',hm.supplier_invoice_ref,
          'historical_company_owned',hm.company_owned,'historical_company_cost_net',hm.company_cost_net,'historical_paper_status',hm.paper_status
        ))).* from public.transport_trips t
        left join public.customers cu on cu.id=t.customer_id
        left join public.transport_vehicles v on v.id=t.vehicle_id
        left join public.transport_truck_types tt on tt.id=t.truck_type_id
        left join public.transport_drivers d on d.id=t.driver_id
        left join public.suppliers s on s.id=v.supplier_id
        left join public.transport_historical_trip_identity hi on hi.trip_id=t.id and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id and hi.operating_location_id=t.operating_location_id
        left join public.transport_historical_operational_mapping hm on hm.trip_id=t.id and hm.company_id=t.company_id and hm.business_unit_id=t.business_unit_id and hm.operating_location_id=t.operating_location_id
        where t.id=x.id and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
    ) fr on true
  ), agg as (
    select count(*) n,count(*) filter(where status='complete') completed,
      count(*) filter(where ppr_status='received') received,count(*) filter(where ppr_status is distinct from 'received') pending,
      count(*) filter(where historical_received>0) collected,count(*) filter(where historical_paid>0) paid,
      jsonb_build_object('charge',0,'rent_driver',coalesce(sum(rent),0),'supplier_charges',0,'supplier_paid',coalesce(sum(historical_paid),0),'supplier_balance',coalesce(sum(greatest(historical_supplier_remaining,0)),0),
        'supplier_credit',coalesce(sum(greatest(-historical_supplier_remaining,0)),0),'driver_pay',coalesce(sum(driver_agreed),0),'driver_paid',0,'driver_balance',coalesce(sum(driver_agreed),0),'amount',coalesce(sum(historical_paid),0),
        'company_rate',coalesce(sum(rate),0),'received_company',coalesce(sum(historical_received),0),'remaining_company',coalesce(sum(greatest(historical_customer_remaining,0)),0),'customer_credit',coalesce(sum(greatest(-historical_customer_remaining,0)),0),
        'profit',coalesce(sum(rate-rent-driver_agreed),0),'commission',0) totals from base
  ), statuses as (
    select v.key,v.label,v.narration,v.sort_order,count(x.id) count from (values
      ('status:draft','Draft','No customer or supplier rate has been finalized yet.',1),
      ('status:incomplete','Incomplete','Only one of Customer Rate or Supplier Rent is finalized; the other side is still pending.',2),
      ('status:complete','Complete','Customer Rate and Supplier Rent are both finalized, but both financial sides are not yet posted.',3),
      ('status:locked','Locked','Customer billing and every required Supplier Rent are posted. Normal Trip/commercial editing is locked.',4),
      ('status:settled','Settled','Both sides are posted and Customer/Supplier outstanding balances are fully settled.',5)
    ) v(key,label,narration,sort_order) left join base x on 'status:'||x.status=v.key group by v.key,v.label,v.narration,v.sort_order
  ) select jsonb_build_object('snapshot',null,'rows',coalesce((select jsonb_agg(item order by ordinal) from page),'[]'),
    'count',a.n,'completed',a.completed,'paper_pending',a.pending,
    'summary',jsonb_build_object('paper',jsonb_build_object('received',a.received,'not_received',a.pending),
      'collections',case when cv then jsonb_build_object('received',a.collected,'not_received',a.n-a.collected) end,
      'payment',case when sv then jsonb_build_object('paid',a.paid,'not_paid',a.n-a.paid) end),
    'statuses',coalesce((select jsonb_agg(to_jsonb(statuses)-'sort_order' order by sort_order) from statuses),'[]'),'totals',a.totals)
    into answer from agg a;
  if not (cv and sv) then
    answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));
    answer:=jsonb_set(answer,'{totals}',public._transport_mask_financial_row(answer->'totals',cv,sv));
  end if;
  return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));
 end if;
 needs_cells:=p_filters->>'snapshot'='true' or p_option_key is not null or (coalesce(p_sort,'')<>'' and p_sort not in ('trip_date','payment_date')) or coalesce(p_filters->>'search','')<>'' or exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f where jsonb_array_length(f.value)>0);
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
 supplier_invoice_agg as materialized (
  select r.trip_id,
         string_agg(distinct p.order_no, ', ' order by p.order_no) order_nos
  from public.transport_trip_supplier_rents r
  join public.transport_supplier_document_rents l on l.rent_id=r.id and not l.is_adjustment
  join public.transport_supplier_documents d on d.id=l.document_id
  join public.purchase_orders p on p.id=d.purchase_order_id
  join public.transport_active_journals j on j.id=d.journal_entry_id
  where sv and r.company_id=c and r.business_unit_id=b
  group by r.trip_id
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
  select r.id,r.trip_date,r.payment_date,r.trip_no,r full_row,
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
  r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,case when cv then coalesce(cca.amount,0) else 0 end n_customer_charges,(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end) n_rent_driver,case when sv then coalesce(sca.amount,0) else 0 end n_supplier_charges,coalesce(r.supplier_paid_net,0) n_supplier_paid,greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0) n_supplier_balance,greatest(coalesce(r.supplier_credit_gross,0),0) n_supplier_credit,coalesce(r.driver_accrued,r.driver_pay,0) n_driver_pay,coalesce(r.driver_paid,0) n_driver_paid,coalesce(r.driver_outstanding,0) n_driver_balance,coalesce(r.payment_amount,0) n_amount,coalesce(r.billed_customer_net,r.customer_rate,0) n_company_rate,coalesce(r.received_from_company,0) n_received_company,greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0) n_remaining_company,greatest(coalesce(r.customer_credit_gross,0),0) n_customer_credit,(coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)) n_profit,coalesce(r.commission_paid_net,0) n_commission,case when cv then coalesce(cia.order_no,r.historical_customer_invoice_ref) end invoice_no_raw,case when sv then coalesce(sia.order_nos,r.historical_supplier_invoice_ref) end supplier_invoice_no_raw,jsonb_build_object('cells',case when needs_cells then jsonb_build_object(
'trip_no',coalesce(nullif(r.trip_no,''),'?'),
'source_trip_id',coalesce(nullif((select bt.transport_source_trip_id from public.transport_trips bt where bt.id=r.id),''),nullif(substring(r.notes from 'Legacy CSV Trip ([0-9]+)'),''),'?'),
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
'invoice_no',coalesce(nullif(case when cv then coalesce(cia.order_no,r.historical_customer_invoice_ref) end,''),'?'),
'supplier_invoice_no',coalesce(nullif(case when sv then coalesce(sia.order_nos,r.historical_supplier_invoice_ref) end,''),'?'),
'sale_type',coalesce(nullif(r.sale_type,''),'?'),
'rent_driver',to_char((coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end),'FM999,999,999,999,999,990.00'),
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
'profit',to_char((coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)),'FM999,999,999,999,999,990.00'),
'commission',to_char(coalesce(r.commission_paid_net,0),'FM999,999,999,999,999,990.00')) else '{}'::jsonb end, 'numbers',case when needs_cells then jsonb_build_object(
'charge',case when cv then coalesce(cca.amount,0) else 0 end,
'rent_driver',(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end),
'supplier_charges',case when sv then coalesce(sca.amount,0) else 0 end,
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
'profit',(coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)),
'commission',coalesce(r.commission_paid_net,0)) else '{}'::jsonb end) vals from (select fr.* from public.transport_financial_register fr where cv and sv and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc) union all select masked.* from public.transport_financial_register fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv) and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc)) r left join agreed_rents ar on ar.trip_id=r.id
    left join customer_charge_agg cca on cca.trip_id=r.id
    left join supplier_charge_agg sca on sca.trip_id=r.id
    left join customer_invoice_agg cia on cia.trip_id=r.id
    left join supplier_invoice_agg sia on sia.trip_id=r.id
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
 ), filtered_without_status as materialized (
  select * from scoped x where
   (coalesce(btrim(p_filters->>'search'),'')='' or case when p_filters->>'searchMode'='starts_with' then
     exists (
       select 1 from jsonb_each_text(x.vals->'cells'||jsonb_build_object('status',x.status,'ppr_status',x.ppr_status)) cell
       cross join lateral (
         select lower(replace(btrim(cell.value),',','')) value
         union all
         select word from regexp_split_to_table(lower(replace(btrim(cell.value),',','')), '[[:space:]]+') word
       ) candidate
       where left(candidate.value,length(lower(replace(btrim(p_filters->>'search'),',',''))))=lower(replace(btrim(p_filters->>'search'),',',''))
     )
     else position(
     lower(replace(btrim(p_filters->>'search'),',',''))
     in lower(replace(concat_ws(' ',
       x.vals->'cells'->>'trip_no',x.vals->'cells'->>'source_trip_id',x.vals->'cells'->>'trip_date',x.vals->'cells'->>'truck_type',
       x.vals->'cells'->>'job_no',x.vals->'cells'->>'invoiced',x.vals->'cells'->>'company',
       x.vals->'cells'->>'driver',x.vals->'cells'->>'owner',x.vals->'cells'->>'plate',
       x.vals->'cells'->>'from',x.vals->'cells'->>'to',x.vals->'cells'->>'charge',x.vals->'cells'->>'supplier_charge',x.vals->'cells'->>'supplier_charges',x.vals->'cells'->>'paper_received_by',
       x.vals->'cells'->>'rent_driver',x.vals->'cells'->>'supplier_paid',x.vals->'cells'->>'supplier_balance',
       x.vals->'cells'->>'supplier_credit',x.vals->'cells'->>'driver_pay',x.vals->'cells'->>'driver_paid',
       x.vals->'cells'->>'driver_balance',x.vals->'cells'->>'payment_date',x.vals->'cells'->>'amount',
       x.vals->'cells'->>'company_rate',x.vals->'cells'->>'received_company',x.vals->'cells'->>'remaining_company',
       x.vals->'cells'->>'customer_credit',x.vals->'cells'->>'profit',x.vals->'cells'->>'commission',
       x.vals->'cells'->>'invoice_no',x.vals->'cells'->>'supplier_invoice_no',x.vals->'cells'->>'sale_type',x.status,x.ppr_status
     ),',',''))
   )>0 end)
   and not exists(select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f
    where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
     and not f.value @> jsonb_build_array(x.vals->'cells'->>f.key))
 ), filtered as materialized (
  select * from filtered_without_status x where coalesce(jsonb_array_length(p_filters->'statuses'),0)=0 or exists(select 1 from jsonb_array_elements_text(p_filters->'statuses') s where s='status:'||x.status)
 ), chosen as materialized (
  select x.id,x.status,x.full_row,x.n_customer_charges customer_charges,x.n_rent_driver rent,x.n_supplier_charges supplier_charges,x.n_profit profit,x.invoice_no_raw invoice_no,x.supplier_invoice_no_raw supplier_invoice_no,row_number() over(order by case when p_direction='asc' and p_sort='trip_date' then x.trip_date end asc,
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
  select case when cv and sv then to_jsonb(chosen.full_row) else public._transport_mask_financial_row(to_jsonb(chosen.full_row),cv,sv) end||jsonb_build_object('status',chosen.status,'customer_charges',chosen.customer_charges,'supplier_rent',chosen.rent,'supplier_charges',chosen.supplier_charges,'trip_profit',chosen.profit,'invoice_no',case when cv then nullif(chosen.invoice_no,'') end,'supplier_invoice_no',case when sv then nullif(chosen.supplier_invoice_no,'') end) row,chosen.ordinal
  from chosen
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
  order by value),
 statuses as (
  select v.key,v.label,v.narration,v.sort_order,count(x.id) count
  from (values
    ('status:draft','Draft','No customer or supplier rate has been finalized yet.',1),
    ('status:incomplete','Incomplete','Only one of Customer Rate or Supplier Rent is finalized; the other side is still pending.',2),
    ('status:complete','Complete','Customer Rate and Supplier Rent are both finalized, but both financial sides are not yet posted.',3),
    ('status:locked','Locked','Customer billing and every required Supplier Rent are posted. Normal Trip/commercial editing is locked.',4),
    ('status:settled','Settled','Both sides are posted and Customer/Supplier outstanding balances are fully settled.',5)
  ) v(key,label,narration,sort_order)
  left join filtered_without_status x on 'status:'||x.status=v.key
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
 if not (cv and sv) then
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));
 answer:=jsonb_set(answer,'{totals}',public._transport_mask_financial_row(answer->'totals',cv,sv));
 end if;
 return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));
end $function$
;
