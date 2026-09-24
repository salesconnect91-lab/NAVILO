create table if not exists public.gate_pass_loading_instructions (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null default public.current_company_id(),
 business_unit_id uuid not null default public.current_business_unit_id(),
 instruction text not null,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid()
);
create unique index if not exists gate_pass_loading_instructions_unique_active on public.gate_pass_loading_instructions(company_id,business_unit_id,lower(btrim(instruction)));
alter table public.gate_pass_loading_instructions enable row level security;
drop policy if exists gp_loading_instructions_select on public.gate_pass_loading_instructions;
create policy gp_loading_instructions_select on public.gate_pass_loading_instructions for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
drop policy if exists gp_loading_instructions_insert on public.gate_pass_loading_instructions;
create policy gp_loading_instructions_insert on public.gate_pass_loading_instructions for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
drop policy if exists gp_loading_instructions_update on public.gate_pass_loading_instructions;
create policy gp_loading_instructions_update on public.gate_pass_loading_instructions for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
grant select,insert,update on public.gate_pass_loading_instructions to authenticated;