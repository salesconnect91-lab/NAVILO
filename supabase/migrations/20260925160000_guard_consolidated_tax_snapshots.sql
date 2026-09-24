-- Consolidated documents must carry their dated header tax rate on every
-- taxable line/charge. Posted documents and journal history are untouched.
create function public.guard_consolidated_tax_child()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_type text; v_company uuid; v_bu uuid; v_rate numeric; v_status text;
  v_taxable boolean; v_context text;
begin
  if tg_table_name in ('consolidated_sales_invoice_lines','consolidated_sales_invoice_charges') then
    v_context:='sales';
    select invoice_type,company_id,business_unit_id,tax_percent,status
      into v_type,v_company,v_bu,v_rate,v_status
      from public.consolidated_sales_invoices where id=new.invoice_id;
  else
    v_context:='purchase';
    select invoice_type,company_id,business_unit_id,tax_percent,status
      into v_type,v_company,v_bu,v_rate,v_status
      from public.consolidated_purchase_invoices where id=new.invoice_id;
  end if;
  if v_company is null or v_company<>public.current_company_id() or
     v_bu<>public.current_business_unit_id() or
     new.company_id is distinct from v_company or
     new.business_unit_id is distinct from v_bu or v_status<>'draft' then
    raise exception 'Consolidated invoice child must belong to an active draft in this workspace.';
  end if;
  if tg_table_name in ('consolidated_sales_invoice_charges','consolidated_purchase_invoice_charges') then
    select cm.tax_applicable into v_taxable from public.charge_master cm
      where cm.company_id=v_company and cm.charge_key=new.charge_key
        and cm.is_active and cm.applies_to in (v_context,'both');
    if not found then raise exception 'Active % charge configuration is required.',v_context; end if;
  else
    v_taxable:=true;
  end if;
  if v_type='Tax Invoice' and v_taxable then
    if round(coalesce(new.tax_percent,0),4)<>round(v_rate,4) then
      raise exception 'Consolidated invoice tax rate must match its dated header snapshot: %%%.',v_rate;
    end if;
  elsif coalesce(new.tax_percent,0)<>0 then
    raise exception 'Non-tax invoices and tax-exempt charges cannot contain VAT/tax.';
  end if;
  return new;
end $$;
revoke all on function public.guard_consolidated_tax_child() from public,anon,authenticated;

do $$ declare v_table text; begin
  foreach v_table in array array['consolidated_sales_invoice_lines',
    'consolidated_sales_invoice_charges','consolidated_purchase_invoice_lines',
    'consolidated_purchase_invoice_charges'] loop
    execute format('create trigger zz_guard_consolidated_tax_child before insert or update
      on public.%I for each row execute function public.guard_consolidated_tax_child()',v_table);
  end loop;
end $$;

-- An invoice may have been edited after its children were saved; recheck its
-- snapshots immediately before the draft becomes posted. Sales posting uses
-- the stored header totals, so also reconcile those against its children.
create function public.guard_consolidated_tax_post()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_context text; v_bad boolean; v_bad_charge boolean; v_subtotal numeric; v_item_tax numeric;
  v_charges numeric; v_charge_tax numeric;
begin
  if old.status='posted' or new.status<>'posted' then return new; end if;
  v_context:=case when tg_table_name='consolidated_sales_invoices' then 'sales' else 'purchase' end;
  if v_context='sales' then
    select exists(select 1 from public.consolidated_sales_invoice_lines l where l.invoice_id=new.id
      and (l.company_id is distinct from new.company_id or l.business_unit_id is distinct from new.business_unit_id or
        round(coalesce(l.tax_percent,0),4)<>case when new.invoice_type='Tax Invoice' then round(new.tax_percent,4) else 0 end))
    into v_bad;
    select coalesce(sum(l.line_total),0),coalesce(sum(l.line_total*l.tax_percent/100),0)
      into v_subtotal,v_item_tax from public.consolidated_sales_invoice_lines l where l.invoice_id=new.id;
    select coalesce(sum(c.amount),0),coalesce(sum(c.amount*c.tax_percent/100),0),
      coalesce(bool_or(c.company_id is distinct from new.company_id or c.business_unit_id is distinct from new.business_unit_id or
        cm.id is null or round(coalesce(c.tax_percent,0),4)<>case when new.invoice_type='Tax Invoice' and cm.tax_applicable then round(new.tax_percent,4) else 0 end),false)
      into v_charges,v_charge_tax,v_bad_charge
      from public.consolidated_sales_invoice_charges c
      left join public.charge_master cm on cm.company_id=new.company_id and cm.charge_key=c.charge_key
        and cm.is_active and cm.applies_to in ('sales','both')
      where c.invoice_id=new.id;
  else
    select exists(select 1 from public.consolidated_purchase_invoice_lines l where l.invoice_id=new.id
      and (l.company_id is distinct from new.company_id or l.business_unit_id is distinct from new.business_unit_id or
        round(coalesce(l.tax_percent,0),4)<>case when new.invoice_type='Tax Invoice' then round(new.tax_percent,4) else 0 end))
    into v_bad;
    select coalesce(sum(c.amount),0),coalesce(sum(c.amount*c.tax_percent/100),0),
      coalesce(bool_or(c.company_id is distinct from new.company_id or c.business_unit_id is distinct from new.business_unit_id or
        cm.id is null or round(coalesce(c.tax_percent,0),4)<>case when new.invoice_type='Tax Invoice' and cm.tax_applicable then round(new.tax_percent,4) else 0 end),false)
      into v_charges,v_charge_tax,v_bad_charge
      from public.consolidated_purchase_invoice_charges c
      left join public.charge_master cm on cm.company_id=new.company_id and cm.charge_key=c.charge_key
        and cm.is_active and cm.applies_to in ('purchase','both')
      where c.invoice_id=new.id;
  end if;
  if v_bad or v_bad_charge then
    raise exception 'Consolidated invoice line or charge tax does not match its header snapshot.';
  end if;
  if v_context='sales' and
     (round(new.subtotal,2)<>round(v_subtotal,2) or
      round(new.item_tax,2)<>round(v_item_tax,2) or
      round(new.charges_total,2)<>round(v_charges,2) or
      round(new.charge_tax,2)<>round(v_charge_tax,2) or
      round(new.total,2)<>round(v_subtotal+v_item_tax+v_charges+v_charge_tax,2)) then
    raise exception 'Consolidated Sales Invoice totals must match saved lines and charges before posting.';
  end if;
  return new;
end $$;
revoke all on function public.guard_consolidated_tax_post() from public,anon,authenticated;
create trigger zz_guard_consolidated_tax_post before update of status on public.consolidated_sales_invoices
for each row execute function public.guard_consolidated_tax_post();
create trigger zz_guard_consolidated_tax_post before update of status on public.consolidated_purchase_invoices
for each row execute function public.guard_consolidated_tax_post();

-- The existing Sales Charge Master trigger searches by key alone. The same
-- key can exist in different companies; resolve it in the charge's company.
do $$ declare v_old text; v_new text; begin
  select pg_get_functiondef('public.enforce_consolidated_sales_charge_master()'::regprocedure)
    into v_old;
  v_new:=replace(v_old,
    'where cm.charge_key=new.charge_key and cm.is_active=true',
    'where cm.company_id=new.company_id and cm.charge_key=new.charge_key and cm.is_active=true');
  if v_new=v_old then
    raise exception 'Consolidated sales Charge Master tenant lookup no longer matches expected source';
  end if;
  execute v_new;
end $$;
