-- Enforce Driver classification only on canonical operational assignment paths.
-- Historical rows are not rewritten and unchanged legacy assignments are not touched.

do $$
declare f text;
begin
 select pg_get_functiondef('public.transport_create_trips(uuid,uuid,uuid,jsonb)'::regprocedure) into f;
 if position('perform public.transport_assert_trip_driver' in f)=0 then
   f:=replace(f,
     'if nullif(row_data->>''driver_id'','''') is not null then',
     'if nullif(row_data->>''driver_id'','''') is not null then
   perform public.transport_assert_trip_driver((row_data->>''driver_id'')::uuid);');
   if position('perform public.transport_assert_trip_driver' in f)=0 then
     raise exception 'transport_create_trips driver guard insertion point changed';
   end if;
   execute f;
 end if;
end $$;

do $$
declare f text;
begin
 select pg_get_functiondef('public.transport_replace_trip_assignment(uuid,uuid,uuid,text)'::regprocedure) into f;
 if position('perform public.transport_assert_trip_driver' in f)=0 then
   f:=replace(f,
     'if p_driver_id is not null then',
     'if p_driver_id is not null then
  perform public.transport_assert_trip_driver(p_driver_id);');
   if position('perform public.transport_assert_trip_driver' in f)=0 then
     raise exception 'transport_replace_trip_assignment driver guard insertion point changed';
   end if;
   execute f;
 end if;
end $$;

notify pgrst,'reload schema';
