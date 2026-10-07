-- Preserve Batch 1 master_manage protection while allowing the separately
-- authorized Mobile Quick Entry feature to create only Truck Types/Locations.
-- Vehicle expense types and all updates remain master_manage-only.
do $migration$
declare v_def text;
begin
 select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_batch1_guard' and p.pronargs=0;
 if v_def is null then raise exception 'transport_batch1_guard() not found'; end if;
 v_def:=replace(v_def,
'if not public.has_transport_action_permission(new.company_id,''master_manage'') then raise exception ''Transport master permission required''; end if;',
'if not public.has_transport_action_permission(new.company_id,''master_manage'')
      and not (tg_op=''INSERT'' and tg_table_name in (''transport_truck_types'',''transport_locations'') and public.can_transport_mobile_quick_create())
   then raise exception ''Transport master permission required''; end if;');
 execute v_def;
end $migration$;
