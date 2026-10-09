-- Expose truck type with original vehicle snapshot on service document display.
-- No journal, trip, or vehicle identity mutation.
begin;
CREATE OR REPLACE FUNCTION public.transport_document_trip_details(p_side text, p_order_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view and active branch required';end if;
 if p_side is null or p_side not in ('customer','supplier') then raise exception 'Invalid document side';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select src.order_id,src.order_no,t.id trip_id,t.trip_no,t.trip_date,t.from_location,t.to_location,t.po_do_job_no,coalesce(nullif(btrim(t.truck_type),''),ty.name) truck_type,
 a.vehicle_no_snapshot vehicle_no,a.driver_name_snapshot driver_name,case when public.transport_financial_read_allowed('supplier') then a.owner_name_snapshot end owner_name,
 coalesce(a.vehicle_no_snapshot,'Unattributed') attribution_vehicle
 from public.transport_party_document_sources src join public.transport_trips t on t.id=any(src.trip_ids)
 join public.journal_entries j on j.id=src.journal_entry_id
 left join public.transport_truck_types ty on ty.id=t.truck_type_id and ty.company_id=c and ty.business_unit_id=b
 left join lateral(select * from public.transport_trip_assignments a where a.trip_id=t.id and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at) order by a.effective_at desc limit 1) a on true
 where src.company_id=c and src.business_unit_id=b and src.operating_location_id=loc and src.side=p_side
 and (p_order_id is null or src.order_id=p_order_id)
 order by src.order_id,t.id limit greatest(1,least(p_limit,1000)) offset greatest(p_offset,0)
 ) q;return answer;
end $function$
;
commit;