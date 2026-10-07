-- Mobile Quick Entry has its own narrowly-scoped create authorization.
-- Preserve master_manage for normal Transport master maintenance and preserve
-- the separate vehicle ownership gate. Only new Driver/Location/Truck Type
-- records created from an authorized Mobile Quick Entry session bypass
-- master_manage; updates/deletes and Vehicle creation are unchanged.
do $migration$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='transport_master_data_guard' and p.pronargs=0;
  if v_def is null then raise exception 'transport_master_data_guard() not found'; end if;
  if position('or (not public.has_transport_action_permission(new.company_id,''master_manage'')' in v_def)=0 then
    raise exception 'Expected transport master permission guard not found';
  end if;
  v_def:=replace(v_def,
'or (not public.has_transport_action_permission(new.company_id,''master_manage'')
     and not (tg_table_name=''transport_vehicles'' and exists(select 1 from public.transport_master_owner_gate where transaction_id=txid_current() and vehicle_id=new.id)))',
'or (not public.has_transport_action_permission(new.company_id,''master_manage'')
     and not (tg_op=''INSERT'' and tg_table_name in (''transport_drivers'',''transport_locations'',''transport_truck_types'') and public.can_transport_mobile_quick_create())
     and not (tg_table_name=''transport_vehicles'' and exists(select 1 from public.transport_master_owner_gate where transaction_id=txid_current() and vehicle_id=new.id)))');
  execute v_def;
end $migration$;
