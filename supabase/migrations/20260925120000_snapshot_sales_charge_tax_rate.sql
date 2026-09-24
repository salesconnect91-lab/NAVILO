-- Validate sales charges against the invoice's dated tax snapshot, not the
-- company's oldest rate. No posted documents or journal entries are updated.
create or replace function public.enforce_sales_charge_settings()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_type text;
  v_company uuid;
  v_unit uuid;
  v_snapshot numeric;
  v_master public.charge_master%rowtype;
begin
  select invoice_type,company_id,business_unit_id,tax_percent
    into v_type,v_company,v_unit,v_snapshot
    from public.sales_orders where id=new.order_id;
  if v_company is null or v_company<>public.current_company_id() or
     new.company_id<>v_company or v_unit<>public.current_business_unit_id() or
     new.business_unit_id<>v_unit then
    raise exception 'Invoice charge does not belong to the active company/business unit.';
  end if;
  select * into v_master from public.charge_master
    where company_id=v_company and charge_key=new.charge_key and is_active
      and applies_to in ('sales','both');
  if not found then raise exception 'Charge % is not active for sales.',new.charge_key; end if;
  if v_master.is_fixed and round(coalesce(new.rate,0),4)<>round(v_master.default_rate,4) then
    raise exception 'The configured fixed rate for % is %.',v_master.charge_name,v_master.default_rate;
  end if;
  if v_type='Tax Invoice' and v_master.tax_applicable then
    if round(coalesce(new.tax_percent,0),4)<>round(v_snapshot,4) then
      raise exception 'Charge tax rate must match its invoice snapshot: %%%.',v_snapshot;
    end if;
  elsif coalesce(new.tax_percent,0)<>0 then
    raise exception 'Tax is not allowed for this charge/document.';
  end if;
  return new;
end $$;
revoke all on function public.enforce_sales_charge_settings() from public,anon,authenticated;
