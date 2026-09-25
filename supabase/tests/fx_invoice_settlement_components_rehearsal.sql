-- Local-only arithmetic rehearsal. No company, transaction or posting data.
begin;
do $$
declare v_result record; v_rejected boolean;
begin
  select * into strict v_result
    from public.fx_invoice_settlement_components('sales',100,0.91,0.95);
  if (v_result.cleared_party_base,v_result.cash_bank_base,
      v_result.fx_gain_base,v_result.fx_loss_base)
     is distinct from (91::numeric,95::numeric,4::numeric,0::numeric) then
    raise exception 'Sales receipt did not clear 91 base and recognize 4 FX gain';
  end if;
  select * into strict v_result
    from public.fx_invoice_settlement_components('purchase',100,0.91,0.95);
  if (v_result.cleared_party_base,v_result.cash_bank_base,
      v_result.fx_gain_base,v_result.fx_loss_base)
     is distinct from (91::numeric,95::numeric,0::numeric,4::numeric) then
    raise exception 'Purchase payment did not clear 91 base and recognize 4 FX loss';
  end if;
  select * into strict v_result
    from public.fx_invoice_settlement_components('sales',100,0.91,0.88);
  if (v_result.cleared_party_base,v_result.cash_bank_base,
      v_result.fx_gain_base,v_result.fx_loss_base)
     is distinct from (91::numeric,88::numeric,0::numeric,3::numeric) then
    raise exception 'Falling rate did not recognize sales FX loss';
  end if;
  select * into strict v_result
    from public.fx_invoice_settlement_components('purchase',100,0.91,0.88);
  if (v_result.cleared_party_base,v_result.cash_bank_base,
      v_result.fx_gain_base,v_result.fx_loss_base)
     is distinct from (91::numeric,88::numeric,3::numeric,0::numeric) then
    raise exception 'Falling rate did not recognize purchase FX gain';
  end if;
  select * into strict v_result
    from public.fx_invoice_settlement_components('sales',40,0.91,0.95);
  if (v_result.cleared_party_base,v_result.cash_bank_base,
      v_result.fx_gain_base,v_result.fx_loss_base)
     is distinct from (36.4::numeric,38::numeric,1.6::numeric,0::numeric) then
    raise exception 'Partial FX receipt does not preserve original invoice rate';
  end if;
  select * into strict v_result
    from public.fx_invoice_settlement_components('sales',100,1,1);
  if (v_result.cleared_party_base,v_result.cash_bank_base,
      v_result.fx_gain_base,v_result.fx_loss_base)
     is distinct from (100::numeric,100::numeric,0::numeric,0::numeric) then
    raise exception 'Company base currency must have zero exchange difference';
  end if;
  v_rejected:=false;
  begin
    perform * from public.fx_invoice_settlement_components('sales',100,0,0.95);
  exception when raise_exception then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Missing/zero invoice rate accepted'; end if;
  raise notice 'PASS: locked invoice rate clears party; payment rate books cash and directionally correct FX difference';
end $$;
rollback;
