alter table public.charge_master add column if not exists purchase_treatment text not null default 'landed_cost';
alter table public.charge_master drop constraint if exists charge_master_purchase_treatment_check;
alter table public.charge_master add constraint charge_master_purchase_treatment_check check (purchase_treatment in ('landed_cost','expense'));