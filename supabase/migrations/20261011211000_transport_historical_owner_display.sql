-- Read-only original Owner fallback; never changes dated ownership or accounting.
do $$
declare name text;definition text;original text:='COALESCE(t.owner_name_snapshot, v.owner_name, s.name) AS owner_name';
begin
 for name in select unnest(array['transport_financial_register']) loop
  definition:=pg_get_viewdef(('public.'||name)::regclass,true);
  if position(original in definition)=0 or position('transport_historical_trip_identity hi' in definition)=0 then
   raise exception 'Unexpected % definition; review before migration',name;
  end if;
  definition:=replace(definition,original,'COALESCE(t.owner_name_snapshot, v.owner_name, s.name, hi.owner_name_snapshot) AS owner_name');
  execute format('create or replace view public.%I as %s',name,definition);
 end loop;
end $$;
