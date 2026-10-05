create or replace function public.transport_create_source_trips(p_request_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();r jsonb;clean jsonb:='[]'::jsonb;created jsonb;item jsonb;i int:=0;src_company text;src_trip text;tid uuid;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required';end if;
 if p_request_id is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Request ID and 1–500 source Trip rows are required';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by lower(btrim(x->>'source_company')),lower(btrim(x->>'source_trip_id')) having count(*)>1) then raise exception 'Duplicate Source Company + Source Trip ID in file';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  src_company:=nullif(btrim(r->>'source_company'),'');src_trip:=nullif(btrim(r->>'source_trip_id'),'');
  if src_company is null or src_trip is null then raise exception 'Source Company and Source Trip ID are required';end if;
  if exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and lower(btrim(t.transport_source_company))=lower(src_company) and lower(btrim(t.transport_source_trip_id))=lower(src_trip)) then raise exception 'Source Trip already exists: % / %',src_company,src_trip;end if;
  clean:=clean||jsonb_build_array(r-'source_company'-'source_trip_id');
 end loop;
 created:=public.transport_create_trips(p_request_id,c,b,clean);
 if jsonb_array_length(created)<>jsonb_array_length(p_rows) then raise exception 'Unexpected source Trip create result';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  item:=created->i;tid=(item->>'id')::uuid;src_company:=btrim(r->>'source_company');src_trip:=btrim(r->>'source_trip_id');
  update public.transport_trips set transport_source_company=src_company,transport_source_trip_id=src_trip where id=tid and company_id=c and business_unit_id=b;
  i:=i+1;
 end loop;
 return created;
end$$;
revoke all on function public.transport_create_source_trips(uuid,jsonb) from public,anon;
grant execute on function public.transport_create_source_trips(uuid,jsonb) to authenticated;