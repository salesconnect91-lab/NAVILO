-- Preserve all original movement/detail accounting paths.
-- Replace only the scoped document and total branches; no financial rows change.
CREATE OR REPLACE FUNCTION public.transport_opening_invoice_query(p_kind text, p_side text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.transport_financial_read_allowed(p_side) then raise exception 'Side financial view and active workspace required';end if;
 if p_kind not in('documents','movements','summary','details') or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid opening invoice query';end if;
 -- Opening-invoice list/summary should never compute trip display for every imported document.
 -- Restrict to only active, unconverted records before retrieving trip labels or allocations.
 IF p_kind='summary' THEN
 WITH eligible AS MATERIALIZED (
 SELECT d.*
 FROM public.transport_opening_invoice_documents d
 JOIN public.transport_active_journals j ON j.id=d.journal_entry_id
 LEFT JOIN public.transport_register_invoice_conversions cv ON cv.document_id=d.id
 WHERE d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
  AND d.side=p_side
  AND (cv.status IS DISTINCT FROM 'posted' OR d.opening_remaining<0)
  AND (nullif(p_filters->>'party','') IS NULL OR d.party_id=(p_filters->>'party')::uuid)
  AND (nullif(p_filters->>'to','') IS NULL OR d.opening_date<=(p_filters->>'to')::date)
  AND (
   coalesce(p_filters->>'search','')=''
   OR position(lower(p_filters->>'search') IN lower(concat_ws(' ',d.party_name,d.original_reference)))>0
   OR EXISTS (
    SELECT 1 FROM public.transport_opening_invoice_lines l
    JOIN public.transport_trips t ON t.id=l.trip_id
    LEFT JOIN public.transport_historical_trip_identity h ON h.trip_id=t.id
    WHERE l.document_id=d.id
     AND position(lower(p_filters->>'search') IN lower(concat_ws(' ',t.trip_no,h.source_trip_id,'Opening Trip '||coalesce(nullif(h.source_trip_id,''),t.trip_no))))>0
   )
  )
), paid AS MATERIALIZED (
 SELECT a.document_id,sum(a.amount) AS amount
 FROM public.transport_opening_invoice_allocations a
 JOIN eligible d ON d.id=a.document_id
 JOIN public.transport_active_journals j ON j.id=a.journal_entry_id
 GROUP BY a.document_id
)

 SELECT jsonb_build_object(
  'count',count(*),
  'outstanding',coalesce(sum(greatest(d.opening_remaining-coalesce(p.amount,0),0)),0),
  'credit',coalesce(sum(greatest(coalesce(p.amount,0)-d.opening_remaining,0)),0))
 INTO answer FROM eligible d LEFT JOIN paid p ON p.document_id=d.id;
 RETURN answer;
 END IF;
 IF p_kind='documents' THEN
 WITH eligible AS MATERIALIZED (
 SELECT d.*
 FROM public.transport_opening_invoice_documents d
 JOIN public.transport_active_journals j ON j.id=d.journal_entry_id
 LEFT JOIN public.transport_register_invoice_conversions cv ON cv.document_id=d.id
 WHERE d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
  AND d.side=p_side
  AND (cv.status IS DISTINCT FROM 'posted' OR d.opening_remaining<0)
  AND (nullif(p_filters->>'party','') IS NULL OR d.party_id=(p_filters->>'party')::uuid)
  AND (nullif(p_filters->>'to','') IS NULL OR d.opening_date<=(p_filters->>'to')::date)
  AND (
   coalesce(p_filters->>'search','')=''
   OR position(lower(p_filters->>'search') IN lower(concat_ws(' ',d.party_name,d.original_reference)))>0
   OR EXISTS (
    SELECT 1 FROM public.transport_opening_invoice_lines l
    JOIN public.transport_trips t ON t.id=l.trip_id
    LEFT JOIN public.transport_historical_trip_identity h ON h.trip_id=t.id
    WHERE l.document_id=d.id
     AND position(lower(p_filters->>'search') IN lower(concat_ws(' ',t.trip_no,h.source_trip_id,'Opening Trip '||coalesce(nullif(h.source_trip_id,''),t.trip_no))))>0
   )
  )
), paid AS MATERIALIZED (
 SELECT a.document_id,sum(a.amount) AS amount
 FROM public.transport_opening_invoice_allocations a
 JOIN eligible d ON d.id=a.document_id
 JOIN public.transport_active_journals j ON j.id=a.journal_entry_id
 GROUP BY a.document_id
)

 SELECT coalesce(jsonb_agg(q.row ORDER BY q.sort_key),'[]'::jsonb) INTO answer
 FROM (
  SELECT d.id::text AS sort_key,
   to_jsonb(d) || jsonb_build_object(
    'order_id',d.id,'order_no',coalesce(d.original_reference,'Opening Trip '||coalesce(t.trip_no,'')),
    'order_date',d.opening_date,'kind','opening_balance',
    'trip_ids',coalesce(t.trip_ids,array[]::uuid[]),'trip_no',coalesce(t.trip_no,''),
    'current_billed_gross',CASE WHEN cv.status='posted' THEN 0 ELSE d.original_gross END,
    'current_paid_gross',d.historical_settled+coalesce(p.amount,0),
    'current_refunded_gross',0,
    'current_outstanding_gross',greatest(d.opening_remaining-coalesce(p.amount,0),0),
    'current_credit_gross',greatest(coalesce(p.amount,0)-d.opening_remaining,0)
   ) AS row
  FROM eligible d
  LEFT JOIN paid p ON p.document_id=d.id
  LEFT JOIN public.transport_register_invoice_conversions cv ON cv.document_id=d.id
  LEFT JOIN LATERAL (
   SELECT array_agg(l.trip_id ORDER BY h.source_row,l.trip_id) AS trip_ids,
     string_agg(coalesce(nullif(h.source_trip_id,''),t.trip_no),' / ' ORDER BY h.source_row,l.trip_id) AS trip_no
   FROM public.transport_opening_invoice_lines l
   JOIN public.transport_trips t ON t.id=l.trip_id
   LEFT JOIN public.transport_historical_trip_identity h ON h.trip_id=t.id
   WHERE l.document_id=d.id
  ) t ON true
  ORDER BY d.id
  LIMIT greatest(1,least(coalesce(p_limit,100),1000))
  OFFSET greatest(coalesce(p_offset,0),0)
 )q;
 RETURN answer;
 END IF;

 if p_kind='details' then
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from(select d.side,d.id order_id,d.party_id,d.party_name,coalesce(d.original_reference,'Opening Trip '||coalesce(nullif(h.source_trip_id,''),t.trip_no)) order_no,
 coalesce(nullif(h.source_trip_id,''),t.trip_no) trip_no,t.trip_date,m.raw_source->>9 from_location,m.raw_source->>10 to_location,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(h.vehicle_no_snapshot,'vehicle') ELSE h.vehicle_no_snapshot END vehicle_no,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(h.driver_name_snapshot,'driver') ELSE h.driver_name_snapshot END driver_name,h.owner_name_snapshot owner_name,h.truck_type_snapshot truck_type,t.po_do_job_no,
 null::numeric base_amount,null::numeric charge_amount,d.original_net source_net,d.original_gross-d.original_net tax_amount,d.original_gross total_amount,'Original source totals; separate charge breakdown not supplied'::text charge_breakdown
 from public.transport_opening_invoice_documents d join public.transport_opening_invoice_lines l on l.document_id=d.id join public.transport_trips t on t.id=l.trip_id
 join public.transport_historical_operational_mapping m on m.trip_id=t.id join public.transport_historical_trip_identity h on h.trip_id=t.id join public.transport_active_journals j on j.id=d.journal_entry_id
 where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and d.side=p_side
 and (nullif(p_filters->>'party','') is null or d.party_id=(p_filters->>'party')::uuid)
 and (nullif(p_filters->>'to','') is null or d.opening_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',coalesce(nullif(h.source_trip_id,''),t.trip_no),d.original_reference,d.party_name)))>0)
 order by d.id,l.trip_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0))q;
 return answer;end if;
 if p_kind='summary' then
 select jsonb_build_object('count',count(*),'outstanding',coalesce(sum(d.current_outstanding_gross),0),'credit',coalesce(sum(d.current_credit_gross),0)) into answer
 from public.transport_opening_invoice_balances d where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and d.side=p_side
 and (nullif(p_filters->>'party','') is null or d.party_id=(p_filters->>'party')::uuid)
 and (nullif(p_filters->>'to','') is null or d.order_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',d.trip_no,d.order_no,d.party_name)))>0);
 return answer;end if;
 with docs as(select d.* from public.transport_opening_invoice_balances d where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc and d.side=p_side
 and (nullif(p_filters->>'party','') is null or d.party_id=(p_filters->>'party')::uuid)
 and (nullif(p_filters->>'to','') is null or d.order_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',d.trip_no,d.order_no,d.party_name)))>0)),
 events as(select d.id::text||':opening' event_id,d.side,d.party_id,d.party_name,d.order_id,d.order_no,d.trip_ids,d.trip_no,d.kind,'opening_balance'::text event_type,d.journal_entry_id,j.entry_no,d.opening_date event_date,d.created_at,
 'Imported opening balance; original issue date unavailable'::text description,
 case when d.side='customer' then greatest(d.opening_remaining,0) else greatest(-d.opening_remaining,0) end debit,
 case when d.side='supplier' then greatest(d.opening_remaining,0) else greatest(-d.opening_remaining,0) end credit,
 d.opening_remaining amount,0::numeric net_amount,d.original_net,d.original_gross,d.historical_settled
 from docs d join public.journal_entries j on j.id=d.journal_entry_id
 union all
 select d.id::text||':'||j.id::text,d.side,d.party_id,d.party_name,d.order_id,d.order_no,d.trip_ids,d.trip_no,d.kind,
 case when j.reversal_of_entry_id is not null then 'reversal_' else '' end||case when d.side='customer' then 'receipt' else 'payment' end,
 j.id,j.entry_no,j.entry_date,j.created_at,j.description,
 case when d.side='supplier' and j.reversal_of_entry_id is null or d.side='customer' and j.reversal_of_entry_id is not null then sum(a.amount) else 0 end,
 case when d.side='customer' and j.reversal_of_entry_id is null or d.side='supplier' and j.reversal_of_entry_id is not null then sum(a.amount) else 0 end,
 case when j.reversal_of_entry_id is not null then sum(a.amount) else -sum(a.amount) end,0::numeric,null::numeric,null::numeric,null::numeric
 from docs d join public.transport_opening_invoice_allocations a on a.document_id=d.id join public.journal_entries j on j.id=a.journal_entry_id or j.reversal_of_entry_id=a.journal_entry_id
 where j.status='posted' and (nullif(p_filters->>'to','') is null or j.entry_date<=(p_filters->>'to')::date)
 group by d.id,d.side,d.party_id,d.party_name,d.order_id,d.order_no,d.trip_ids,d.trip_no,d.kind,j.id)
 select coalesce(jsonb_agg(q.row),'[]') into answer from(
 select row from (select d.order_id::text sort_key,to_jsonb(d) row from docs d where p_kind='documents' union all select e.event_id,to_jsonb(e) from events e where p_kind='movements') r order by sort_key limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0))q;
 return answer;
end $function$

REVOKE ALL ON FUNCTION public.transport_opening_invoice_query(text,text,jsonb,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transport_opening_invoice_query(text,text,jsonb,integer,integer) TO authenticated;
