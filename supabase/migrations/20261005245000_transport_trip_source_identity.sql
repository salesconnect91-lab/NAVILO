alter table public.transport_trips add column if not exists transport_source_company text;
alter table public.transport_trips add column if not exists transport_source_trip_id text;
create unique index if not exists transport_trips_source_identity_uidx
on public.transport_trips(company_id,business_unit_id,lower(btrim(transport_source_company)),lower(btrim(transport_source_trip_id)))
where nullif(btrim(transport_source_company),'') is not null and nullif(btrim(transport_source_trip_id),'') is not null;

create or replace function public.transport_source_trip_status(p_source_company text,p_source_trip_id text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); t public.transport_trips%rowtype;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required'; end if;
 if nullif(btrim(p_source_company),'') is null or nullif(btrim(p_source_trip_id),'') is null then
   return jsonb_build_object('status','Error','reason','Source Company and Source Trip ID are required');
 end if;
 select * into t from public.transport_trips
 where company_id=c and business_unit_id=b
 and lower(btrim(transport_source_company))=lower(btrim(p_source_company))
 and lower(btrim(transport_source_trip_id))=lower(btrim(p_source_trip_id))
 limit 1;
 if not found then return jsonb_build_object('status','New'); end if;
 return jsonb_build_object('status','Duplicate','trip_id',t.id,'trip_no',t.trip_no);
end$$;
revoke all on function public.transport_source_trip_status(text,text) from public,anon;
grant execute on function public.transport_source_trip_status(text,text) to authenticated;