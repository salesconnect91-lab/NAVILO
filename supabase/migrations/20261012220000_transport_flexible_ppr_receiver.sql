-- Flexible PPR receiver without creating software logins.
alter table public.transport_trips add column if not exists ppr_receiver_type text;
do $guard$
declare definition text; before_text text; after_text text;
begin
  before_text := 'if new.ppr_received_by_employee_id is null or new.ppr_received_date is null then raise exception ''PPR received requires employee and date'';end if;';
  after_text := 'if new.ppr_received_date is null or (new.ppr_received_by_employee_id is null and (new.ppr_receiver_type is null or nullif(btrim(new.ppr_received_by_name),'''') is null)) then raise exception ''PPR received requires receiver name and date'';end if;';
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transport_trip_batch1_guard';
  if definition is null or position(before_text in definition)=0 then raise exception 'Unexpected PPR guard version; migration stopped safely';end if;
  definition:=replace(definition,before_text,after_text);
  before_text:='select name into v_name from public.employees where id=new.ppr_received_by_employee_id and company_id=new.company_id and is_active;if v_name is null then raise exception ''PPR employee company mismatch or inactive'';end if;new.ppr_received_by_name:=v_name;';
  after_text:='if new.ppr_received_by_employee_id is not null then select name into v_name from public.employees where id=new.ppr_received_by_employee_id and company_id=new.company_id and is_active;if v_name is null then raise exception ''PPR employee company mismatch or inactive'';end if;new.ppr_received_by_name:=v_name;end if;';
  if position(before_text in definition)=0 then raise exception 'Unexpected PPR employee validation; migration stopped safely';end if;
  execute replace(definition,before_text,after_text);
end $guard$;
alter table public.transport_trips add constraint transport_ppr_receiver_type_chk check (ppr_receiver_type is null or ppr_receiver_type in ('employee','driver','supplier','other')) not valid;
create or replace function public.transport_receive_ppr_flexible(p_trip_id uuid,p_receiver_type text,p_receiver_name text,p_date date,p_attachment text default null,p_employee_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $fn$
declare t public.transport_trips%rowtype; v_name text;
begin
  if auth.uid() is null then raise exception 'Login required';end if;
  if not public.has_transport_action_permission(public.current_company_id(),'ppr_receive') or not public.has_transport_action_permission(public.current_company_id(),'trip_edit') then raise exception 'PPR receive permission required';end if;
  if p_receiver_type not in ('employee','driver','supplier','other') then raise exception 'Select receiver type';end if;
  if nullif(btrim(p_receiver_name),'') is null or length(btrim(p_receiver_name))>150 then raise exception 'Receiver name required (max 150 characters)';end if;
  if p_date is null then raise exception 'PPR date required';end if;
  if p_receiver_type<>'employee' and p_employee_id is not null then raise exception 'Employee ID is only valid for employees';end if;
  select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
  if not found then raise exception 'Trip not found in active workspace';end if;
  if t.ppr_status='received' then raise exception 'PPR already received; use authorized correction';end if;
  if p_receiver_type='employee' and p_employee_id is not null then
    select e.name into v_name from public.employees e where e.id=p_employee_id and e.company_id=t.company_id and e.is_active;
    if v_name is null then raise exception 'Employee not active in company';end if;
  else
    v_name:=btrim(p_receiver_name);
  end if;
  update public.transport_trips set ppr_status='received',ppr_received_date=p_date,ppr_received_by_employee_id=p_employee_id,ppr_received_by_name=v_name,ppr_receiver_type=p_receiver_type,ppr_attachment_path=coalesce(p_attachment,t.ppr_attachment_path) where id=t.id;
  return t.id;
end $fn$;
revoke all on function public.transport_receive_ppr_flexible(uuid,text,text,date,text,uuid) from public;
grant execute on function public.transport_receive_ppr_flexible(uuid,text,text,date,text,uuid) to authenticated;
