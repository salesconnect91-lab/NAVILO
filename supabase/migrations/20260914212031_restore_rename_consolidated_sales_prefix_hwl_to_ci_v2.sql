do $$
declare v_oid oid; v_def text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_consolidated_invoice_from_order_commitment' order by p.oid limit 1;
 if v_oid is not null then v_def:=pg_get_functiondef(v_oid); if position('HWL-' in v_def)>0 then v_def:=replace(v_def,'''HWL-''','''CI-'''); execute v_def; end if; end if;
end $$;
select set_config('app.maintenance_reset','1',true);
update public.consolidated_sales_invoices set invoice_no='CI-'||substr(invoice_no,5) where invoice_no like 'HWL-%';