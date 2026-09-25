begin;

alter table public.invoice_payment_allocations
  add column if not exists currency_code text,
  add column if not exists invoice_exchange_rate numeric(24,10),
  add column if not exists settlement_exchange_rate numeric(24,10),
  add column if not exists base_party_amount numeric(24,2),
  add column if not exists base_cash_bank_amount numeric(24,2),
  add column if not exists realized_fx_amount numeric(24,2);

alter table public.purchase_payment_allocations
  add column if not exists currency_code text,
  add column if not exists invoice_exchange_rate numeric(24,10),
  add column if not exists settlement_exchange_rate numeric(24,10),
  add column if not exists base_party_amount numeric(24,2),
  add column if not exists base_cash_bank_amount numeric(24,2),
  add column if not exists realized_fx_amount numeric(24,2);

create or replace function public.snapshot_customer_receipt_allocation_fx()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text; v_currency text; v_invoice_rate numeric; v_settlement numeric;
begin
 select coalesce(nullif(s.currency_code,''),c.base_currency_code),
        case when coalesce(nullif(s.currency_code,''),c.base_currency_code)=c.base_currency_code then 1 else s.exchange_rate end,
        c.base_currency_code
 into v_currency,v_invoice_rate,v_base
 from public.sales_orders s join public.companies c on c.id=s.company_id where s.id=new.sales_order_id;
 if v_currency is null then return new; end if;
 if v_invoice_rate is null or v_invoice_rate<=0 then raise exception 'Allocated sales invoice has no valid locked FX rate.'; end if;
 select coalesce(jl.source_exchange_rate,je.exchange_rate,1) into v_settlement
 from public.journal_entries je join public.journal_lines jl on jl.entry_id=je.id
 where je.id=new.journal_entry_id and jl.debit>0 and jl.amount_basis='source_currency'
 order by jl.debit desc limit 1;
 v_settlement:=coalesce(v_settlement,case when v_currency=v_base then 1 else null end);
 if v_settlement is null or v_settlement<=0 then raise exception 'Customer receipt has no valid settlement FX rate.'; end if;
 new.currency_code:=v_currency; new.invoice_exchange_rate:=v_invoice_rate; new.settlement_exchange_rate:=v_settlement;
 new.base_party_amount:=round(new.amount*v_invoice_rate,2);
 new.base_cash_bank_amount:=round(new.amount*v_settlement,2);
 new.realized_fx_amount:=round(new.base_cash_bank_amount-new.base_party_amount,2);
 return new;
end $$;

create or replace function public.snapshot_supplier_payment_allocation_fx()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text; v_currency text; v_invoice_rate numeric; v_settlement numeric;
begin
 select coalesce(nullif(p.currency_code,''),c.base_currency_code),
        case when coalesce(nullif(p.currency_code,''),c.base_currency_code)=c.base_currency_code then 1 else p.exchange_rate end,
        c.base_currency_code
 into v_currency,v_invoice_rate,v_base
 from public.purchase_orders p join public.companies c on c.id=p.company_id where p.id=new.purchase_order_id;
 if v_currency is null then return new; end if;
 if v_invoice_rate is null or v_invoice_rate<=0 then raise exception 'Allocated purchase invoice has no valid locked FX rate.'; end if;
 select coalesce(jl.source_exchange_rate,je.exchange_rate,1) into v_settlement
 from public.journal_entries je join public.journal_lines jl on jl.entry_id=je.id
 where je.id=new.journal_entry_id and jl.credit>0 and jl.amount_basis='source_currency'
 order by jl.credit desc limit 1;
 v_settlement:=coalesce(v_settlement,case when v_currency=v_base then 1 else null end);
 if v_settlement is null or v_settlement<=0 then raise exception 'Supplier payment has no valid settlement FX rate.'; end if;
 new.currency_code:=v_currency; new.invoice_exchange_rate:=v_invoice_rate; new.settlement_exchange_rate:=v_settlement;
 new.base_party_amount:=round(new.amount*v_invoice_rate,2);
 new.base_cash_bank_amount:=round(new.amount*v_settlement,2);
 new.realized_fx_amount:=round(new.base_party_amount-new.base_cash_bank_amount,2);
 return new;
end $$;

revoke all on function public.snapshot_customer_receipt_allocation_fx() from public,anon,authenticated;
revoke all on function public.snapshot_supplier_payment_allocation_fx() from public,anon,authenticated;

drop trigger if exists snapshot_customer_receipt_allocation_fx on public.invoice_payment_allocations;
create trigger snapshot_customer_receipt_allocation_fx before insert on public.invoice_payment_allocations
for each row execute function public.snapshot_customer_receipt_allocation_fx();

drop trigger if exists snapshot_supplier_payment_allocation_fx on public.purchase_payment_allocations;
create trigger snapshot_supplier_payment_allocation_fx before insert on public.purchase_payment_allocations
for each row execute function public.snapshot_supplier_payment_allocation_fx();

comment on column public.invoice_payment_allocations.realized_fx_amount is 'Base-currency realized FX: positive is customer receipt gain; negative is loss.';
comment on column public.purchase_payment_allocations.realized_fx_amount is 'Base-currency realized FX: positive is supplier payment gain; negative is loss.';

notify pgrst,'reload schema';
commit;
