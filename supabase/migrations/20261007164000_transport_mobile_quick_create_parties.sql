-- Narrow Customer/Supplier creation path for Transport Mobile Quick Entry.
-- Does not grant Master module create/edit access.
create or replace function public.transport_mobile_quick_create_party(
 p_party_type text,p_name text,p_email text default null,p_phone text default null,p_address text default null,
 p_ntn text default null,p_strn text default null,p_cnic text default null,p_tax_registration_status text default 'unregistered'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id(); v_user uuid:=public.legacy_data_user_id(); v_account uuid; v_id uuid; v_mapping text;
begin
 if not public.can_transport_mobile_quick_create() then raise exception 'Mobile Quick Entry create permission required'; end if;
 if p_party_type not in ('customer','supplier') then raise exception 'Unsupported party type'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'Name is required'; end if;
 if coalesce(p_tax_registration_status,'unregistered') not in ('registered','unregistered') then raise exception 'Invalid tax registration status'; end if;
 if p_tax_registration_status='registered' and nullif(trim(coalesce(p_strn,'')),'') is null and nullif(trim(coalesce(p_ntn,'')),'') is null then raise exception 'Registered party requires STRN or NTN'; end if;
 v_mapping:=case when p_party_type='customer' then 'accounts_receivable' else 'accounts_payable' end;
 select account_id into v_account from public.account_mappings where user_id=v_user and company_id=v_company and mapping_key=v_mapping limit 1;
 if v_account is null then raise exception '% mapping is not configured',case when p_party_type='customer' then 'Accounts Receivable' else 'Accounts Payable' end; end if;
 if p_party_type='customer' then
  insert into public.customers(user_id,company_id,name,name_urdu,email,phone,address,account_id,ntn,strn,cnic,tax_registration_status)
  values(v_user,v_company,trim(p_name),null,nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_address,'')),''),v_account,nullif(trim(coalesce(p_ntn,'')),''),nullif(trim(coalesce(p_strn,'')),''),nullif(trim(coalesce(p_cnic,'')),''),coalesce(p_tax_registration_status,'unregistered')) returning id into v_id;
 else
  insert into public.suppliers(user_id,company_id,name,name_urdu,email,phone,address,account_id,ntn,strn,cnic,tax_registration_status)
  values(v_user,v_company,trim(p_name),null,nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_address,'')),''),v_account,nullif(trim(coalesce(p_ntn,'')),''),nullif(trim(coalesce(p_strn,'')),''),nullif(trim(coalesce(p_cnic,'')),''),coalesce(p_tax_registration_status,'unregistered')) returning id into v_id;
 end if;
 return jsonb_build_object('id',v_id,'name',trim(p_name));
end $$;
revoke all on function public.transport_mobile_quick_create_party(text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.transport_mobile_quick_create_party(text,text,text,text,text,text,text,text,text) to authenticated;
