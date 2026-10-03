-- Cache executable query plans, never identity/scope results. Existing SQL bodies,
-- STABLE volatility, SECURITY DEFINER, search_path, costs and grants are retained.
-- This avoids re-planning the same scope query thousands of times per posting.
do $$
declare name text;f record;definition text;query text;body text;
begin
 foreach name in array array['current_company_id','current_business_unit_id','current_operating_location_id','legacy_data_user_id','is_platform_owner'] loop
  select p.prosrc,p.provolatile,p.prosecdef,l.lanname into strict f
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid=to_regprocedure('public.'||name||'()');
  if f.lanname<>'sql' or f.provolatile<>'s' or not f.prosecdef then raise exception 'Unexpected scope helper attributes: %',name;end if;
  definition:=pg_get_functiondef(to_regprocedure('public.'||name||'()'));
  query:=regexp_replace(btrim(f.prosrc),';\s*$','');
  body:='BEGIN RETURN ('||query||'); END;';
  if position(f.prosrc in definition)=0 or position('LANGUAGE sql' in definition)=0 then raise exception 'Unexpected scope helper definition: %',name;end if;
  execute replace(replace(definition,'LANGUAGE sql','LANGUAGE plpgsql'),f.prosrc,body);
 end loop;
end $$;
