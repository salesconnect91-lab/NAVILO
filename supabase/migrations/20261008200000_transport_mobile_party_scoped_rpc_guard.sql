-- Complete Transport Mobile Quick Entry Customer/Supplier creation and lookup.
-- Do not grant Master module permissions or rewrite historical party/accounting rows.
-- A private, transaction-local capability gates ONLY the vetted create RPC insert.
create table if not exists public.transport_mobile_party_insert_gate (
  transaction_id bigint not null,
  company_id uuid not null,
  business_unit_id uuid not null,
  actor_id uuid not null,
  party_type text not null check (party_type in ('customer','supplier')),
  normalized_name text not null,
  primary key (transaction_id, company_id, business_unit_id, actor_id, party_type, normalized_name)
);
alter table public.transport_mobile_party_insert_gate enable row level security;
revoke all on table public.transport_mobile_party_insert_gate from public, anon, authenticated;

-- Preserve Transport business-unit check, same-Company check, advisory duplicate
-- serialization and canonical duplicate rule. Only replace the master privilege
-- condition with a narrowly scoped, unforgeable RPC transaction capability.
create or replace function public.transport_quick_party_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare duplicate boolean;
begin
 if not exists(select 1 from public.business_units
   where id=public.current_business_unit_id()
     and company_id=public.current_company_id()
     and unit_type='transport' and is_active)
 then return new; end if;

 if new.company_id is distinct from public.current_company_id()
    or not (
      coalesce(public.has_transport_action_permission(new.company_id,'master_manage'),false)
      or (
        auth.uid() is not null
        and public.can_transport_mobile_quick_create()
        and exists (
          select 1 from public.transport_mobile_party_insert_gate gate
          where gate.transaction_id=txid_current()
            and gate.company_id=new.company_id
            and gate.business_unit_id=public.current_business_unit_id()
            and gate.actor_id=auth.uid()
            and gate.party_type=case tg_table_name when 'customers' then 'customer' when 'suppliers' then 'supplier' else '' end
            and gate.normalized_name=public.transport_master_normalized_key(new.name)
        )
      )
    )
 then raise exception 'Transport master permission and active Company required'; end if;

 perform pg_advisory_xact_lock(
   hashtextextended(tg_table_name||new.company_id::text||public.transport_master_normalized_key(new.name),0)
 );
 execute format(
   'select exists(select 1 from public.%I where company_id=$1 and public.transport_master_normalized_key(name)=$2)',
   tg_table_name
 ) into duplicate using new.company_id,public.transport_master_normalized_key(new.name);
 if duplicate then raise exception 'Duplicate canonical % name in this Company',tg_table_name; end if;
 return new;
end $$;
revoke all on function public.transport_quick_party_guard() from public, anon, authenticated;

-- This existing RPC keeps its original authorization, tax validation and AR/AP
-- mappings; the transient gate permits only the intended insert within this call.
create or replace function public.transport_mobile_quick_create_party(
 p_party_type text,p_name text,p_email text default null,p_phone text default null,p_address text default null,
 p_ntn text default null,p_strn text default null,p_cnic text default null,p_tax_registration_status text default 'unregistered'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_company uuid:=public.current_company_id();
 v_unit uuid:=public.current_business_unit_id();
 v_actor uuid:=auth.uid();
 v_user uuid:=public.legacy_data_user_id();
 v_account uuid; v_id uuid; v_mapping text;
begin
 if v_actor is null or not public.can_transport_mobile_quick_create()
 then raise exception 'Mobile Quick Entry create permission required'; end if;
 if not exists(select 1 from public.business_units
   where id=v_unit and company_id=v_company and unit_type='transport' and is_active)
 then raise exception 'Active Transport business unit required'; end if;
 if p_party_type not in ('customer','supplier') then raise exception 'Unsupported party type'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'Name is required'; end if;
 if coalesce(p_tax_registration_status,'unregistered') not in ('registered','unregistered') then raise exception 'Invalid tax registration status'; end if;
 if p_tax_registration_status='registered'
   and nullif(trim(coalesce(p_strn,'')),'') is null
   and nullif(trim(coalesce(p_ntn,'')),'') is null
 then raise exception 'Registered party requires STRN or NTN'; end if;

 v_mapping:=case when p_party_type='customer' then 'accounts_receivable' else 'accounts_payable' end;
 select account_id into v_account from public.account_mappings
 where user_id=v_user and company_id=v_company and mapping_key=v_mapping limit 1;
 if v_account is null
 then raise exception '% mapping is not configured',
      case when p_party_type='customer' then 'Accounts Receivable' else 'Accounts Payable' end;
 end if;

 insert into public.transport_mobile_party_insert_gate(
   transaction_id,company_id,business_unit_id,actor_id,party_type,normalized_name)
 values(txid_current(),v_company,v_unit,v_actor,p_party_type,public.transport_master_normalized_key(trim(p_name)));

 if p_party_type='customer' then
   insert into public.customers(user_id,company_id,name,name_urdu,email,phone,address,account_id,ntn,strn,cnic,tax_registration_status)
   values(v_user,v_company,trim(p_name),null,nullif(trim(coalesce(p_email,'')),''),
     nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_address,'')),''),
     v_account,nullif(trim(coalesce(p_ntn,'')),''),nullif(trim(coalesce(p_strn,'')),''),
     nullif(trim(coalesce(p_cnic,'')),''),coalesce(p_tax_registration_status,'unregistered'))
   returning id into v_id;
 else
   insert into public.suppliers(user_id,company_id,name,name_urdu,email,phone,address,account_id,ntn,strn,cnic,tax_registration_status)
   values(v_user,v_company,trim(p_name),null,nullif(trim(coalesce(p_email,'')),''),
     nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_address,'')),''),
     v_account,nullif(trim(coalesce(p_ntn,'')),''),nullif(trim(coalesce(p_strn,'')),''),
     nullif(trim(coalesce(p_cnic,'')),''),coalesce(p_tax_registration_status,'unregistered'))
   returning id into v_id;
 end if;

 delete from public.transport_mobile_party_insert_gate
 where transaction_id=txid_current() and company_id=v_company
   and business_unit_id=v_unit and actor_id=v_actor and party_type=p_party_type
   and normalized_name=public.transport_master_normalized_key(trim(p_name));

 return jsonb_build_object('id',v_id,'name',trim(p_name));
end $$;
revoke all on function public.transport_mobile_quick_create_party(text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.transport_mobile_quick_create_party(text,text,text,text,text,text,text,text,text) to authenticated;

-- Mobile dropdown lookup returns only names/IDs from active Company, without
-- granting broader Master Data SELECT, CREATE, UPDATE or DELETE privileges.
create or replace function public.transport_mobile_quick_list_parties(p_party_type text)
returns table(id uuid,name text,is_active boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_company uuid:=public.current_company_id();
begin
 if auth.uid() is null or not public.can_transport_mobile_quick_create()
 then raise exception 'Mobile Quick Entry create permission required'; end if;
 if not exists(select 1 from public.business_units
   where id=public.current_business_unit_id() and company_id=v_company
     and unit_type='transport' and is_active)
 then raise exception 'Active Transport business unit required'; end if;
 if p_party_type='customer' then
   return query select c.id,c.name,c.is_active from public.customers c
   where c.company_id=v_company and c.is_active=true order by c.id;
 elsif p_party_type='supplier' then
   return query select s.id,s.name,s.is_active from public.suppliers s
   where s.company_id=v_company and s.is_active=true order by s.id;
 else
   raise exception 'Unsupported party type';
 end if;
end $$;
revoke all on function public.transport_mobile_quick_list_parties(text) from public, anon;
grant execute on function public.transport_mobile_quick_list_parties(text) to authenticated;
