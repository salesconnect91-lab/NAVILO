-- NAVILO authenticated tenant/BU security rehearsal.
-- LOCAL ISOLATED SUPABASE ONLY. Entire test rolls back.
begin;

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_company_a uuid;
  v_company_b uuid;
  v_bu_a uuid;
  v_bu_b uuid;
begin
  -- Synthetic auth users.
  insert into auth.users(id, role, email, created_at, updated_at)
  values
    (v_user_a, 'authenticated', 'security-a@navilo.test', now(), now()),
    (v_user_b, 'authenticated', 'security-b@navilo.test', now(), now());

  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values
    (v_user_a,v_user_a,'security-a@navilo.test','sales','user',true),
    (v_user_b,v_user_b,'security-b@navilo.test','viewer','user',true);

  -- Companies automatically receive their default BU.
  insert into public.companies(name,code,status)
  values ('Security Company A','SEC_A_' || substr(replace(gen_random_uuid()::text,'-',''),1,8),'active')
  returning id into v_company_a;

  insert into public.companies(name,code,status)
  values ('Security Company B','SEC_B_' || substr(replace(gen_random_uuid()::text,'-',''),1,8),'active')
  returning id into v_company_b;

  select id into v_bu_a
  from public.business_units
  where company_id=v_company_a and is_default;

  select id into v_bu_b
  from public.business_units
  where company_id=v_company_b and is_default;

  -- Company membership automatically creates default-BU membership.
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values
    (v_company_a,v_user_a,'sales',true),
    (v_company_b,v_user_b,'viewer',true);

  -- Explicit BU module entitlements.
  insert into public.business_unit_modules
    (business_unit_id,company_id,module_key,enabled)
  values
    (v_bu_a,v_company_a,'sales',true),
    (v_bu_a,v_company_a,'reports',true),
    (v_bu_b,v_company_b,'sales',true),
    (v_bu_b,v_company_b,'reports',true);

  update public.user_profiles
  set last_company_id=v_company_a,
      last_business_unit_id=v_bu_a
  where id=v_user_a;

  -- Simulate a real authenticated tenant session.
  perform set_config('request.jwt.claim.sub',v_user_a::text,true);
  set local role authenticated;

  if auth.uid() <> v_user_a then
    raise exception 'Authenticated JWT context failed';
  end if;

  if public.current_company_id() <> v_company_a then
    raise exception 'Current company resolution failed';
  end if;

  if public.current_business_unit_id() <> v_bu_a then
    raise exception 'Current BU resolution failed';
  end if;

  if not public.has_company_access(v_company_a) then
    raise exception 'Own company access unexpectedly denied';
  end if;

  if public.has_company_access(v_company_b) then
    raise exception 'SECURITY FAILURE: cross-company access allowed';
  end if;

  reset role; update public.business_unit_modules set enabled=false where business_unit_id=v_bu_a and module_key='sales'; set local role authenticated; if public.has_module_permission(v_company_a,'sales','view') then raise exception 'SECURITY FAILURE: disabled BU module still allowed'; end if; reset role; update public.business_unit_modules set enabled=true where business_unit_id=v_bu_a and module_key='sales'; set local role authenticated; if not public.has_module_permission(v_company_a,'sales','view') then
    raise exception 'Sales role cannot view own sales module';
  end if;

  if not public.has_module_permission(v_company_a,'sales','create') then
    raise exception 'Sales role cannot create in own sales module';
  end if;

  if public.has_module_permission(v_company_a,'accounting','view') then
    raise exception 'SECURITY FAILURE: sales role gained accounting view';
  end if;

  if public.has_module_permission(v_company_b,'sales','view') then
    raise exception 'SECURITY FAILURE: cross-company module permission allowed';
  end if;

  reset role; update public.business_unit_memberships set is_active=false where business_unit_id=v_bu_a and user_id=v_user_a; set local role authenticated; if public.has_module_permission(v_company_a,'sales','view') then raise exception 'SECURITY FAILURE: access allowed without active BU membership'; end if; reset role; update public.user_profiles set platform_role='super_admin' where id=v_user_a; set local role authenticated; if not public.is_platform_owner() then raise exception 'SECURITY FAILURE: super_admin not recognized as Platform Owner'; end if; if not public.has_company_access(v_company_b) then raise exception 'SECURITY FAILURE: Platform Owner company access failed'; end if; raise notice 'PASS: authenticated tenant isolation and Platform Owner checks passed';
end $$;

rollback;






