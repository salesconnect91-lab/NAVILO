create or replace function public.transport_financial_trip(p_trip_id uuid)
returns public.transport_trips
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;loc uuid:=public.current_operating_location_id();
begin
 if loc is null then raise exception 'Active operating location required'; end if;
 select * into t from public.transport_trips
 where id=p_trip_id
   and company_id=public.current_company_id()
   and business_unit_id=public.current_business_unit_id()
   and operating_location_id=loc
 for update;
 if not found or t.lifecycle_status='cancelled' or t.status='cancelled'
 then raise exception 'Active Transport Trip in current Company/Business Unit/branch required'; end if;
 return t;
end $$;
notify pgrst,'reload schema';