-- Local-only structural + arithmetic rehearsal for mixed-rate settlement journals.
-- No production data is read or changed.
begin;

do $$
declare
  v_has_column boolean;
  v_result record;
begin
  select exists(
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='journal_lines'
      and column_name='source_exchange_rate'
      and numeric_precision=24
      and numeric_scale=10
  ) into v_has_column;

  if not v_has_column then
    raise exception 'journal_lines.source_exchange_rate numeric(24,10) is missing';
  end if;

  select * into strict v_result
  from public.fx_invoice_settlement_components('sales',100,0.91,0.95);

  if (v_result.cleared_party_base,
      v_result.cash_bank_base,
      v_result.fx_gain_base,
      v_result.fx_loss_base)
     is distinct from
     (91::numeric,95::numeric,4::numeric,0::numeric) then
    raise exception 'Sales mixed-rate settlement arithmetic failed';
  end if;

  if round(100::numeric*0.91,2) <> v_result.cleared_party_base
     or round(100::numeric*0.95,2) <> v_result.cash_bank_base then
    raise exception 'Per-line invoice/settlement rate audit arithmetic failed';
  end if;

  select * into strict v_result
  from public.fx_invoice_settlement_components('purchase',40,0.91,0.88);

  if (v_result.cleared_party_base,
      v_result.cash_bank_base,
      v_result.fx_gain_base,
      v_result.fx_loss_base)
     is distinct from
     (36.4::numeric,35.2::numeric,1.2::numeric,0::numeric) then
    raise exception 'Partial purchase mixed-rate settlement arithmetic failed';
  end if;

  raise notice 'PASS: per-line FX rate foundation supports original invoice rate plus settlement-date rate';
end
$$;

rollback;
