create or replace function public.replace_consolidated_purchase_invoice_charges(p_invoice_id uuid, p_charges jsonb)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_inv public.consolidated_purchase_invoices%rowtype; r jsonb;
begin
  perform public.assert_module_permission('purchase','edit');
  select * into v_inv from public.consolidated_purchase_invoices where id=p_invoice_id and company_id=v_company and business_unit_id=v_bu for update;
  if not found then raise exception 'Consolidated Purchase Invoice not found in active business unit.'; end if;
  if v_inv.status<>'draft' then raise exception 'Only draft Consolidated Purchase Invoice charges can be edited.'; end if;
  delete from public.consolidated_purchase_invoice_charges where invoice_id=p_invoice_id and company_id=v_company and business_unit_id=v_bu;
  for r in select * from jsonb_array_elements(coalesce(p_charges,'[]'::jsonb)) loop
    if coalesce((r->>'amount')::numeric,0)<=0 then continue; end if;
    if not exists(select 1 from public.charge_master cm where cm.company_id=v_company and cm.charge_key=r->>'charge_key' and cm.is_active and cm.applies_to in ('purchase','both')) then
      raise exception 'Charge % is not an active Purchase charge.',r->>'charge_key';
    end if;
    insert into public.consolidated_purchase_invoice_charges(user_id,company_id,business_unit_id,invoice_id,charge_key,amount,tax_percent)
    values(v_inv.user_id,v_company,v_bu,p_invoice_id,r->>'charge_key',round((r->>'amount')::numeric,2),case when v_inv.invoice_type='Tax Invoice' then coalesce((r->>'tax_percent')::numeric,0) else 0 end);
  end loop;
end
$function$;
grant execute on function public.replace_consolidated_purchase_invoice_charges(uuid,jsonb) to authenticated;