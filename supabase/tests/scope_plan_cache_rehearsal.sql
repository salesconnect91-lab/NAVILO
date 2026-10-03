-- Isolated database only. Prepared scope plans must re-read identity and access.
begin;
do $$
declare u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();tag text:=substr(u1::text,1,8);
 c1 uuid;c2 uuid;b1 uuid;b2 uuid;l1 uuid;l2 uuid;i integer;
begin
 insert into auth.users(id,role,email) values(u1,'authenticated','scope-a-'||tag||'@navilo.test'),(u2,'authenticated','scope-b-'||tag||'@navilo.test');
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
 values(u1,u1,'scope-a-'||tag||'@navilo.test','admin','user',true),(u2,u2,'scope-b-'||tag||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Scope A','SPA'||tag,'active') returning id into c1;
 insert into public.companies(name,code,status) values('Scope B','SPB'||tag,'active') returning id into c2;
 select id into strict b1 from public.business_units where company_id=c1 and is_default;
 select id into strict b2 from public.business_units where company_id=c2 and is_default;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c1,u1,'company_owner',true),(c2,u2,'company_owner',true),(c2,u1,'accounts',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
 values(c1,b1,u1,'company_owner',true),(c2,b2,u2,'company_owner',true),(c2,b2,u1,'accounts',true)
 on conflict(business_unit_id,user_id) do update set role=excluded.role,is_active=true;
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 values(c1,b1,'SPA','Scope branch A','branch',true) returning id into l1;
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 values(c2,b2,'SPB','Scope branch B','branch',true) returning id into l2;
 insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
 values(c1,b1,l1,u1,'company_owner',true),(c2,b2,l2,u2,'company_owner',true),(c2,b2,l2,u1,'accounts',true);
 -- User B's stale selection must not grant access to A.
 update public.user_profiles set last_company_id=c1,last_business_unit_id=b1 where id in (u1,u2);
 perform set_config('request.jwt.claim.sub',u1::text,true);execute 'set local role authenticated';
 for i in 1..10 loop
  if public.current_company_id() is distinct from c1 or public.current_business_unit_id() is distinct from b1 or public.current_operating_location_id() is distinct from l1 or public.is_platform_owner() then raise exception 'Initial scope mismatch';end if;
 end loop;
 perform set_config('request.jwt.claim.sub',u2::text,true);
 if public.current_company_id() is distinct from c2 or public.current_business_unit_id() is distinct from b2 or public.current_operating_location_id() is distinct from l2 then raise exception 'Prepared plan retained another actor scope';end if;
 perform set_config('request.jwt.claim.sub',u1::text,true);
 if public.current_company_id() is distinct from c1 then raise exception 'Prepared plan did not restore actor A';end if;
 execute 'reset role';
 update public.user_profiles set last_company_id=c2,last_business_unit_id=b2 where id=u1;
 execute 'set local role authenticated';
 if public.current_company_id() is distinct from c2 or public.current_business_unit_id() is distinct from b2 or public.current_operating_location_id() is distinct from l2 then raise exception 'Prepared plan retained stale selected workspace';end if;
 execute 'reset role';
 update public.user_profiles set is_active=false where id=u1;
 execute 'set local role authenticated';
 if public.current_company_id() is not null or public.current_business_unit_id() is not null or public.current_operating_location_id() is not null or public.is_platform_owner() then raise exception 'Inactive actor retained cached access';end if;
 execute 'reset role';update public.user_profiles set is_active=true where id=u1;
 update public.business_unit_memberships set is_active=false where user_id=u1 and business_unit_id=b2;
 execute 'set local role authenticated';
 if public.current_business_unit_id() is not null or public.current_operating_location_id() is not null then raise exception 'Inactive business unit membership retained cached access';end if;
 execute 'reset role';
 update public.user_profiles set platform_role='super_admin' where id=u1;
 execute 'set local role authenticated';
 if not public.is_platform_owner() or public.current_company_id() is distinct from c2 or public.current_business_unit_id() is distinct from b2 then raise exception 'Platform owner scope changed';end if;
 execute 'reset role';
 update public.user_profiles set platform_role='user' where id=u1;
 update public.companies set status='suspended' where id=c2;
 execute 'set local role authenticated';
 if public.current_company_id() is distinct from c1 or public.current_business_unit_id() is distinct from b1 then raise exception 'Suspended selected company retained access';end if;
 execute 'reset role';
 update public.companies set subscription_expires_at=now()-interval '1 day' where id=c1;
 execute 'set local role authenticated';
 if public.current_company_id() is not null then raise exception 'Expired company retained access';end if;
 perform set_config('request.jwt.claim.sub','',true);
 if public.current_company_id() is not null or public.is_platform_owner() then raise exception 'Unauthenticated scope retained access';end if;
 execute 'reset role';
end $$;
rollback;
