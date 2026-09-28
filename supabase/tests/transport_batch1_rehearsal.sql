-- LOCAL ISOLATED SUPABASE ONLY. Synthetic data rolls back.
\set ON_ERROR_STOP on
begin;
create temporary table transport_fixture(user_id uuid,company_id uuid,unit_a uuid,unit_b uuid,other_company uuid,other_unit uuid,employee_id uuid,supplier_a uuid,supplier_b uuid);
do $$
declare u uuid:=gen_random_uuid(); c uuid; b1 uuid; b2 uuid; c2 uuid; b3 uuid; e uuid; sp1 uuid; sp2 uuid; suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
 insert into auth.users(id,role,email,created_at,updated_at) values(u,'authenticated','transport-'||suffix||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active) values(u,u,'transport-'||suffix||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Transport Rehearsal A','TRA'||suffix,'active') returning id into c;
 insert into public.companies(name,code,status) values('Transport Rehearsal B','TRB'||suffix,'active') returning id into c2;
 insert into public.business_units(company_id,code,name,unit_type) values(c,'T1','Transport 1','transport') returning id into b1;
 insert into public.business_units(company_id,code,name,unit_type) values(c,'T2','Transport 2','transport') returning id into b2;
 insert into public.business_units(company_id,code,name,unit_type) values(c2,'T3','Transport Other','transport') returning id into b3;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
 values(c,b1,u,'company_owner',true),(c,b2,u,'company_owner',true);
 update public.company_modules set enabled=true where company_id=c and module_key='transport';
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
 values(c,b1,'transport',true),(c,b2,'transport',true)
 on conflict(business_unit_id,module_key) do update set enabled=true;
 perform set_config('request.jwt.claim.sub', u::text, true);
 reset role;
 update public.user_profiles set last_company_id=c,last_business_unit_id=b1 where id=u;
 insert into public.employees(user_id,company_id,name)
 values(u,c,'PPR Rehearsal Employee') returning id into e;
 insert into public.suppliers(user_id,company_id,name)
 values(u,c,'Transport Supplier A') returning id into sp1;
 insert into public.suppliers(user_id,company_id,name)
 values(u,c,'Transport Supplier B') returning id into sp2;
 insert into transport_fixture
 values(u,c,b1,b2,c2,b3,e,sp1,sp2);
end $$;
select user_id as rehearsal_user,
       company_id as rehearsal_company,
       unit_a as rehearsal_unit_a,
       unit_b as rehearsal_unit_b,
       other_company as rehearsal_other_company,
       other_unit as rehearsal_other_unit,
       employee_id as rehearsal_employee,
       supplier_a as rehearsal_supplier_a,
       supplier_b as rehearsal_supplier_b
from transport_fixture \gset

select set_config('navilo.rehearsal_user', :'rehearsal_user', true);
select set_config('navilo.rehearsal_company', :'rehearsal_company', true);
select set_config('navilo.rehearsal_unit_a', :'rehearsal_unit_a', true);
select set_config('navilo.rehearsal_unit_b', :'rehearsal_unit_b', true);
select set_config('navilo.rehearsal_other_company', :'rehearsal_other_company', true);
select set_config('navilo.rehearsal_other_unit', :'rehearsal_other_unit', true);
select set_config('navilo.rehearsal_employee', :'rehearsal_employee', true);
select set_config('navilo.rehearsal_supplier_a', :'rehearsal_supplier_a', true);
select set_config('navilo.rehearsal_supplier_b', :'rehearsal_supplier_b', true);
reset role;
update public.user_profiles set last_company_id=:'rehearsal_company',last_business_unit_id=:'rehearsal_unit_a'
where id=:'rehearsal_user';
set role authenticated;
select set_config('request.jwt.claim.sub',:'rehearsal_user',true);
set local role authenticated;

do $$
declare c uuid:=current_setting('navilo.rehearsal_company')::uuid; b uuid:=current_setting('navilo.rehearsal_unit_a')::uuid; t uuid; a text; v uuid; v2 uuid; rejected boolean; inactive_type uuid; employee uuid;
  sp1 uuid; sp2 uuid; t2 uuid; r1 uuid; r2 uuid; ownership uuid;
begin
 if not public.has_transport_action_permission(c,'trip_create') then raise exception 'Owner action default failed'; end if;
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no,owner_type) values(c,b,'TEST-VEHICLE','company') returning id into v;
perform set_config('navilo.rehearsal_unit_a_vehicle',v::text,true);
 insert into public.transport_truck_types(company_id,business_unit_id,name,is_active)
 values(c,b,'Disabled rehearsal type',false) returning id into inactive_type;
 rejected:=false;
 begin insert into public.transport_trips(company_id,business_unit_id,trip_no,truck_type_id)
   values(c,b,'IGNORED',inactive_type); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Inactive Truck Type was accepted'; end if;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,vehicle_id,po_do_job_no)
 values(c,b,'CLIENT-IGNORED',v,null) returning id,trip_no into t,a;
 if a<>'OIC-000001' then raise exception 'Generated number: %',a; end if;
 if not exists(select 1 from public.transport_trips where id=t and lifecycle_status='not_complete' and job_status='pending')
 then raise exception 'Trip defaults failed'; end if;
 update public.transport_trips set po_do_job_no='JOB-1' where id=t;
 if not exists(select 1 from public.transport_trips where id=t and job_status='done') then raise exception 'Job derivation failed'; end if;
 rejected:=false;
 begin update public.transport_trips set lifecycle_status='complete' where id=t;
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Direct lifecycle update permitted'; end if;
 rejected:=false;
 begin update public.transport_trips set ppr_status='received' where id=t;
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'PPR without employee/date permitted'; end if;
 employee := current_setting('navilo.rehearsal_employee')::uuid;
 update public.transport_trips set ppr_status='received',ppr_received_by_employee_id=employee,ppr_received_date=current_date where id=t;
 if not exists(select 1 from public.transport_trips where id=t and ppr_received_by_name='PPR Rehearsal Employee')
 then raise exception 'Valid PPR receipt failed'; end if;
 perform public.transport_finalize_customer_rate(t,1200,'manual');
 if not exists(select 1 from public.transport_trips where id=t and customer_rate_snapshot=1200 and customer_rate_state='finalized')
 then raise exception 'Customer rate finalization failed'; end if;
 perform public.transport_finalize_trip_rent(t);
 if not exists(select 1 from public.transport_trips where id=t and lifecycle_status='complete' and rent_state='finalized')
 then raise exception 'Rent finalization did not complete Trip'; end if;
 perform public.transport_correct_trip_rent(t,100,'Agreed correction');
 if not exists(select 1 from public.transport_trips where id=t and lifecycle_status='complete' and owner_rent=100)
 then raise exception 'Correction changed Complete state'; end if;
 rejected:=false;
 begin delete from public.transport_trips where id=t;
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Direct Trip delete permitted'; end if;
 if not exists(select 1 from public.transport_trip_number_registry where company_id=c and trip_no=a)
 then raise exception 'Issued number missing'; end if;
 rejected:=false;
 begin update public.transport_trip_number_registry set trip_no='TAMPERED' where company_id=c and trip_no=a;
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Issued number was mutable'; end if;
 rejected:=false;
 begin insert into public.transport_trips(company_id,business_unit_id,trip_no)
   values(current_setting('navilo.rehearsal_other_company')::uuid,current_setting('navilo.rehearsal_other_unit')::uuid,'IGNORED');
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Cross-company Trip write permitted'; end if;
 if not exists(select 1 from public.transport_trip_audit where trip_id=t and action='rent_correct')
 then raise exception 'Correction audit missing'; end if;
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no,owner_type)
 values(c,b,'TEST-REPLACEMENT','company') returning id into v2;
 perform public.transport_replace_trip_assignment(t,v2,null,'Vehicle breakdown');
 if not exists(select 1 from public.transport_trip_assignments where trip_id=t and vehicle_id=v2 and reason='Vehicle breakdown')
 then raise exception 'Replacement history missing'; end if;
 insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,effective_from,effective_to)
 values(c,b,v,'company',date '2026-01-01',date '2026-06-30') returning id into ownership;
 rejected:=false;
 begin insert into public.transport_vehicle_ownership(company_id,business_unit_id,vehicle_id,owner_type,effective_from)
   values(c,b,v,'company',date '2026-06-01'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Overlapping ownership accepted'; end if;
sp1 := current_setting('navilo.rehearsal_supplier_a')::uuid;
sp2 := current_setting('navilo.rehearsal_supplier_b')::uuid;
insert into public.transport_trips(company_id,business_unit_id,trip_no) values(c,b,'IGNORED') returning id into t2;
 insert into public.transport_trip_supplier_rents(company_id,business_unit_id,trip_id,supplier_id,supplier_name_snapshot,amount)
 values(c,b,t2,sp1,'Server replaces',300) returning id into r1;
 insert into public.transport_trip_supplier_rents(company_id,business_unit_id,trip_id,supplier_id,supplier_name_snapshot,amount)
 values(c,b,t2,sp2,'Server replaces',250) returning id into r2;
 rejected:=false;
 begin update public.transport_trips set owner_rent=250 where id=t2; exception when others then rejected:=true; end;
 if not rejected then raise exception 'Legacy owner rent and structured rents coexisted'; end if;
 rejected:=false;
 begin perform public.transport_finalize_trip_rent(t2); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Trip completed while supplier rents pending'; end if;
 perform public.transport_finalize_supplier_rent(r1,300);
 perform public.transport_finalize_supplier_rent(r2,250);
 perform public.transport_finalize_trip_rent(t2);
 if not exists(select 1 from public.transport_trips where id=t2 and lifecycle_status='complete')
 then raise exception 'Multi-supplier completion failed'; end if;
 rejected:=false;
 begin update public.transport_trip_audit set action='tampered' where trip_id=t;
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Audit update was permitted'; end if;
 raise notice 'PASS: Trip numbering, lifecycle, Job, PPR, delete protection and audit';
end $$;

reset role;

update public.user_profiles set last_business_unit_id=:'rehearsal_unit_b' where id=:'rehearsal_user';

set role authenticated;
do $$
declare c uuid:=current_setting('navilo.rehearsal_company')::uuid; b uuid:=current_setting('navilo.rehearsal_unit_b')::uuid; n text; rejected boolean:=false;
begin
 insert into public.transport_trips(company_id,business_unit_id,trip_no) values(c,b,'IGNORED') returning trip_no into n;
 if n<>'OIC-000003' then raise exception 'Company sequence reset across BU: %',n; end if;
 begin insert into public.transport_trips(company_id,business_unit_id,trip_no,vehicle_id)
   values(c,b,'IGNORED',current_setting('navilo.rehearsal_unit_a_vehicle')::uuid);
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Cross-BU vehicle reference accepted'; end if;
 perform public.transport_set_trip_prefix('NEW-');
 insert into public.transport_trips(company_id,business_unit_id,trip_no) values(c,b,'IGNORED') returning trip_no into n;
 if n<>'NEW-000004' then raise exception 'Prefix change reset sequence: %',n; end if;
 raise notice 'PASS: company-wide sequence across BUs';
end $$;

-- Explicit false must beat company-owner default; no sensitive direct write succeeds.
reset role;
update public.business_unit_memberships
set permissions =
    jsonb_set(
        coalesce(permissions,'{}'::jsonb),
        '{transport_actions}',
        coalesce(permissions->'transport_actions','{}'::jsonb)
          || jsonb_build_object('trip_create',false),
        true
    )
where business_unit_id=:'rehearsal_unit_b'
  and user_id=:'rehearsal_user';

do $verify_override$
declare
  v_count integer;
  v_override jsonb;
begin
  select count(*)
    into v_count
  from public.business_unit_memberships
  where business_unit_id=current_setting('navilo.rehearsal_unit_b')::uuid
    and user_id=current_setting('navilo.rehearsal_user')::uuid
    and is_active;

  select permissions #> '{transport_actions,trip_create}'
    into v_override
  from public.business_unit_memberships
  where business_unit_id=current_setting('navilo.rehearsal_unit_b')::uuid
    and user_id=current_setting('navilo.rehearsal_user')::uuid
    and is_active
  limit 1;

  if v_count<>1 then
    raise exception 'Expected exactly one active BU membership, found %',v_count;
  end if;

  if jsonb_typeof(v_override)<>'boolean'
     or v_override::text::boolean is distinct from false then
    raise exception 'Fixture failed to persist explicit trip_create=false: %',v_override;
  end if;

  raise notice 'PASS: explicit false fixture persisted';
end
$verify_override$;
set local role authenticated;
do $$
declare c uuid:=current_setting('navilo.rehearsal_company')::uuid; b uuid:=current_setting('navilo.rehearsal_unit_b')::uuid; rejected boolean:=false;
begin
 if public.has_transport_action_permission(c,'trip_create') then raise exception 'Explicit false override ignored'; end if;
 begin insert into public.transport_trips(company_id,business_unit_id,trip_no) values(c,b,'IGNORED');
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Denied Trip creation succeeded'; end if;
 raise notice 'PASS: explicit false server-side denial';
end $$;
reset role;
rollback;
