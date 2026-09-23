create or replace function public.assign_consolidated_purchase_invoice_number_yearwise()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_year text; v_next bigint;
begin
 if new.invoice_date is null then new.invoice_date:=current_date; end if; v_year:=extract(year from new.invoice_date)::int::text;
 if new.invoice_no is null or btrim(new.invoice_no)='' or new.invoice_no like '%-AUTO' or new.invoice_no ~ '^CP(I)?-[0-9]{8}-[0-9]{6}$' then
  perform pg_advisory_xact_lock(hashtext(coalesce(new.company_id::text,'')||':consolidated-purchase:'||v_year));
  select coalesce(max((substring(invoice_no from ('^CPI-'||v_year||'-([0-9]+)$')))::bigint),0)+1 into v_next from public.consolidated_purchase_invoices where company_id is not distinct from new.company_id and invoice_no ~ ('^CPI-'||v_year||'-[0-9]+$');
  new.invoice_no:='CPI-'||v_year||'-'||lpad(v_next::text,4,'0');
 end if; return new;
end $$;