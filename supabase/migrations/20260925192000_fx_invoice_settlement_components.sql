-- Amounts on an invoice remain in its source currency. Clearing AR/AP uses
-- its original locked rate; cash/bank uses the actual settlement-date rate.
-- This function is arithmetic only: callers must validate company/date rates,
-- allocate in source currency and post the resulting FX gain/loss account.
create function public.fx_invoice_settlement_components(
  p_side text,
  p_source_amount numeric,
  p_invoice_rate numeric,
  p_settlement_rate numeric
)
returns table (
  cleared_party_base numeric,
  cash_bank_base numeric,
  fx_gain_base numeric,
  fx_loss_base numeric
)
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare v_delta numeric;
begin
  if p_side not in ('sales','purchase') or p_side is null then
    raise exception 'FX settlement side must be sales or purchase';
  end if;
  if p_source_amount is null or p_source_amount<=0 or
     p_invoice_rate is null or p_invoice_rate<=0 or
     p_settlement_rate is null or p_settlement_rate<=0 then
    raise exception 'FX settlement amount and both locked rates must be positive';
  end if;
  cleared_party_base:=round(p_source_amount*p_invoice_rate,2);
  cash_bank_base:=round(p_source_amount*p_settlement_rate,2);
  if cleared_party_base<=0 or cash_bank_base<=0 then
    raise exception 'FX settlement amount rounds to zero in base currency';
  end if;
  v_delta:=case when p_side='sales' then cash_bank_base-cleared_party_base
                else cleared_party_base-cash_bank_base end;
  fx_gain_base:=greatest(v_delta,0);
  fx_loss_base:=greatest(-v_delta,0);
  return next;
end $$;
revoke all on function public.fx_invoice_settlement_components(text,numeric,numeric,numeric)
  from public,anon;
grant execute on function public.fx_invoice_settlement_components(text,numeric,numeric,numeric)
  to authenticated,service_role;
