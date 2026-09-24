begin;

alter table public.charge_master add column if not exists company_id uuid;
update public.charge_master cm
set company_id = coalesce(
  (select up.last_company_id from public.user_profiles up where up.id = cm.user_id),
  (select m.company_id from public.company_memberships m where m.user_id = cm.user_id order by m.created_at asc limit 1)
)
where cm.company_id is null;
alter table public.charge_master add constraint charge_master_company_id_fkey foreign key (company_id) references public.companies(id) on delete restrict;
create index if not exists idx_charge_master_company_id on public.charge_master(company_id);
alter table public.charge_master drop constraint if exists charge_master_user_key_unique;
create unique index if not exists ux_charge_master_company_key on public.charge_master(company_id, charge_key) where company_id is not null;

insert into public.tenant_table_modules(table_name,module_key)
values ('charge_master','master')
on conflict (table_name) do update set module_key=excluded.module_key;

alter table public.charge_master enable row level security;
drop policy if exists charge_master_select_own on public.charge_master;
drop policy if exists charge_master_insert_own on public.charge_master;
drop policy if exists charge_master_update_own on public.charge_master;
drop policy if exists charge_master_delete_own on public.charge_master;
drop policy if exists tenant_select_charge_master on public.charge_master;
drop policy if exists tenant_insert_charge_master on public.charge_master;
drop policy if exists tenant_update_charge_master on public.charge_master;
drop policy if exists tenant_delete_charge_master on public.charge_master;
create policy tenant_select_charge_master on public.charge_master for select to authenticated using (public.has_module_permission(company_id,'master','view'));
create policy tenant_insert_charge_master on public.charge_master for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'master','create'));
create policy tenant_update_charge_master on public.charge_master for update to authenticated using (public.has_module_permission(company_id,'master','edit')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'master','edit'));
create policy tenant_delete_charge_master on public.charge_master for delete to authenticated using (public.has_module_permission(company_id,'master','delete'));

drop trigger if exists tenant_context_stamp on public.charge_master;
create trigger tenant_context_stamp before insert or update on public.charge_master for each row execute function public.tenant_stamp_company_user();

-- Keep legacy SECURITY DEFINER business logic, but force every legacy user-owned lookup
-- to also stay inside the selected company.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'apply_stock_movement','create_customer_with_ar','create_supplier_with_ap',
        'post_journal_entry','post_sales_invoice','receive_customer_payment','transfer_stock_v2'
      )
  loop
    v_def := pg_get_functiondef(r.oid);
    -- alias-qualified predicates
    v_def := regexp_replace(
      v_def,
      '([A-Za-z_][A-Za-z0-9_]*)\\.user_id[[:space:]]*=[[:space:]]*v_user_id(?![[:space:]]+AND[[:space:]]+\\1\\.company_id)',
      '\\1.user_id = v_user_id AND \\1.company_id = public.current_company_id()',
      'gi'
    );
    -- unqualified predicates in UPDATE/DELETE/selects
    v_def := regexp_replace(
      v_def,
      'where[[:space:]]+user_id[[:space:]]*=[[:space:]]*v_user_id(?![[:space:]]+and[[:space:]]+company_id)',
      'where user_id = v_user_id and company_id = public.current_company_id()',
      'gi'
    );
    v_def := regexp_replace(
      v_def,
      'and[[:space:]]+user_id[[:space:]]*=[[:space:]]*v_user_id(?![[:space:]]+and[[:space:]]+company_id)',
      'and user_id = v_user_id and company_id = public.current_company_id()',
      'gi'
    );
    execute v_def;
  end loop;
end $$;

-- Make default COA initialization company-aware and compatible with company unique indexes.
do $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='initialize_default_coa' and pg_get_function_identity_arguments(p.oid)='';

  v_def := pg_get_functiondef(v_oid);
  v_def := replace(v_def, 'DECLARE' || chr(13) || chr(10) || '  uid uuid := public.legacy_data_user_id();', 'DECLARE' || chr(13) || chr(10) || '  uid uuid := public.legacy_data_user_id();' || chr(13) || chr(10) || '  cid uuid := public.current_company_id();');
  v_def := replace(v_def, 'DECLARE' || chr(10) || '  uid uuid := public.legacy_data_user_id();', 'DECLARE' || chr(10) || '  uid uuid := public.legacy_data_user_id();' || chr(10) || '  cid uuid := public.current_company_id();');
  v_def := replace(v_def, 'WHERE user_id=uid AND code=', 'WHERE company_id=cid AND code=');
  v_def := replace(v_def, 'ON p.user_id=uid', 'ON p.company_id=cid');
  v_def := replace(v_def, 'ON a.user_id=uid', 'ON a.company_id=cid');
  v_def := replace(v_def, 'ON CONFLICT (user_id, code) DO NOTHING', 'ON CONFLICT DO NOTHING');
  v_def := replace(v_def, 'ON CONFLICT (user_id, mapping_key) DO NOTHING', 'ON CONFLICT DO NOTHING');
  execute v_def;
end $$;

-- Lock down helper/function execution explicitly.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('receive_customer_payment','initialize_default_coa')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;