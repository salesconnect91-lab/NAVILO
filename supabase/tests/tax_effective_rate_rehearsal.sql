-- Isolated local database only. All fixture rows roll back.
begin;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_company uuid;
  v_other uuid;
  v_code text := substr(replace(gen_random_uuid()::text,'-',''),1,12);
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values (v_user,'authenticated','tax-rates-'||v_code||'@navilo.test',now(),now());
  insert into public.companies(name,code,status) values ('Tax rate rehearsal','R'||v_code,'trial') returning id into v_company;
  insert into public.companies(name,code,status) values ('Tax rate other','S'||v_code,'trial') returning id into v_other;
  insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from,effective_to)
  values
    (v_user,v_company,'Legacy '||v_code,7,'sales',true,true,current_date,current_date+1),
    (v_user,v_company,'New '||v_code,17.5,'sales',true,true,current_date+2,null),
    (v_user,v_company,'Purchases '||v_code,5,'purchase',true,true,current_date,null),
    (v_user,v_other,'Other '||v_code,99,'both',true,true,current_date,null);

  if public.fixed_tax_rate_on(v_company,'sales',current_date)<>7 or
     public.fixed_tax_rate_on(v_company,'sales',current_date+1)<>7 or
     public.fixed_tax_rate_on(v_company,'sales',current_date+2)<>17.5 or
     public.fixed_tax_rate_on(v_company,'purchase',current_date+2)<>5 or
     public.fixed_tax_rate_on(v_company,'sales',current_date-1) is not null then
    raise exception 'Date, company, or sales/purchase fixed-rate lookup failed';
  end if;
  raise notice 'PASS: rate changes by effective date, company, and sales/purchase context';
end $$;
rollback;
