-- Transport register scale/semantics contract.
-- Run in the authenticated Transport rehearsal context used by the release suite.
-- This test intentionally asserts API invariants without mutating financial evidence.

do $$
declare
  f regprocedure;
  def text;
begin
  f := to_regprocedure('public.transport_register_query(integer,integer,jsonb,text,text,text,text)');
  if f is null then
    raise exception 'transport_register_query signature missing';
  end if;

  select pg_get_functiondef(f) into def;

  if position('least(coalesce(p_limit,500),500)' in def)=0 then
    raise exception '500-row page ceiling contract missing';
  end if;
  if position('current_company_id()' in def)=0 or position('current_business_unit_id()' in def)=0 then
    raise exception 'Company/BU scope contract missing';
  end if;
  if position('transport_financial_read_allowed(' in def)=0 then
    raise exception 'Financial permission masking contract missing';
  end if;
  if position('Transport export permission required' in def)=0 then
    raise exception 'Export permission contract missing';
  end if;
  if position('p_filters->>''search''' in def)=0 then
    raise exception 'Global search contract missing';
  end if;
  if position('p_filters->''columns''' in def)=0 then
    raise exception 'Header column filter contract missing';
  end if;
  if position('sum(x.n_customer_charges)' in def)=0 or position('sum(x.n_supplier_charges)' in def)=0 then
    raise exception 'Charge totals contract missing';
  end if;
end $$;

-- Required supporting indexes for large Transport histories.
do $$
begin
  if to_regclass('public.transport_register_scope_date_id_idx') is null then
    raise exception 'scope/date register index missing';
  end if;
  if to_regclass('public.transport_trips_customer_idx') is null then
    raise exception 'customer/date register index missing';
  end if;
  if to_regclass('public.transport_trips_driver_idx') is null then
    raise exception 'driver/date register index missing';
  end if;
  if to_regclass('public.transport_trips_vehicle_idx') is null then
    raise exception 'vehicle/date register index missing';
  end if;
end $$;
