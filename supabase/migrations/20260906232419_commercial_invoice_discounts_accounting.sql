create table if not exists public.commercial_invoice_discounts (
id uuid primary key default gen_random_uuid(), user_id uuid not null default public.legacy_data_user_id(),
company_id uuid not null default public.current_company_id(), business_unit_id uuid not null default public.current_business_unit_id(),
document_type text not null check (document_type in ('sales_main','sales_consolidated','purchase_main','purchase_consolidated')),
document_no text not null, discount_mode text not null default 'fixed' check (discount_mode in ('fixed','percent')),
discount_value numeric not null default 0 check (discount_value >= 0), discount_amount numeric not null default 0 check (discount_amount >= 0),
created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
unique(company_id,business_unit_id,document_type,document_no));
alter table public.commercial_invoice_discounts enable row level security;
drop policy if exists commercial_invoice_discounts_select on public.commercial_invoice_discounts;
create policy commercial_invoice_discounts_select on public.commercial_invoice_discounts for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
revoke insert,update,delete on public.commercial_invoice_discounts from authenticated,anon;
grant select on public.commercial_invoice_discounts to authenticated;

create or replace function public.ensure_commercial_discount_accounts()
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_allowed uuid; v_received uuid;
begin
if v_uid is null or v_company is null then raise exception 'Authentication and active company are required.'; end if;
select id into v_allowed from public.chart_of_accounts where company_id=v_company and code='6600' limit 1;
if v_allowed is null then insert into public.chart_of_accounts(user_id,company_id,code,name,type,account_role,detail_type,is_group,normal_balance,allow_manual_entries,is_system_account,is_active,description)
values(v_uid,v_company,'6600','Sales Discounts Allowed','expense','general','sales_discount_allowed',false,'debit',false,true,true,'Invoice-level commercial discounts allowed to customers') returning id into v_allowed; end if;
select id into v_received from public.chart_of_accounts where company_id=v_company and code='4300' limit 1;
if v_received is null then insert into public.chart_of_accounts(user_id,company_id,code,name,type,account_role,detail_type,is_group,normal_balance,allow_manual_entries,is_system_account,is_active,description)
values(v_uid,v_company,'4300','Purchase Discounts Received','revenue','general','purchase_discount_received',false,'credit',false,true,true,'Invoice-level commercial discounts received from suppliers') returning id into v_received; end if;
insert into public.account_mappings(user_id,company_id,mapping_key,account_id) values(v_uid,v_company,'sales_discount_allowed',v_allowed)
on conflict (user_id,mapping_key) do update set account_id=excluded.account_id,company_id=excluded.company_id,updated_at=now();
insert into public.account_mappings(user_id,company_id,mapping_key,account_id) values(v_uid,v_company,'purchase_discount_received',v_received)
on conflict (user_id,mapping_key) do update set account_id=excluded.account_id,company_id=excluded.company_id,updated_at=now();
end $$;
grant execute on function public.ensure_commercial_discount_accounts() to authenticated;

create or replace function public.upsert_commercial_invoice_discount(p_document_type text,p_document_no text,p_mode text,p_value numeric,p_amount numeric)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_uid uuid:=public.legacy_data_user_id(); v_company uuid:=public.current_company_id(); v_unit uuid:=public.current_business_unit_id(); v_module text;
begin
if p_document_type not in ('sales_main','sales_consolidated','purchase_main','purchase_consolidated') then raise exception 'Invalid document type.'; end if;
if nullif(btrim(coalesce(p_document_no,'')),'') is null then raise exception 'Document number is required.'; end if;
if p_mode not in ('fixed','percent') then raise exception 'Discount mode must be fixed or percent.'; end if;
if coalesce(p_value,0)<0 or coalesce(p_amount,0)<0 then raise exception 'Discount cannot be negative.'; end if;
if p_mode='percent' and coalesce(p_value,0)>100 then raise exception 'Discount percent cannot exceed 100.'; end if;
v_module:=case when p_document_type like 'sales_%' then 'sales' else 'purchase' end;
perform public.assert_module_permission(v_module,'create'); perform public.ensure_commercial_discount_accounts();
if coalesce(p_amount,0)=0 and coalesce(p_value,0)=0 then delete from public.commercial_invoice_discounts where company_id=v_company and business_unit_id=v_unit and document_type=p_document_type and document_no=btrim(p_document_no); return jsonb_build_object('success',true,'deleted',true); end if;
insert into public.commercial_invoice_discounts(user_id,company_id,business_unit_id,document_type,document_no,discount_mode,discount_value,discount_amount,created_by,updated_at)
values(v_uid,v_company,v_unit,p_document_type,btrim(p_document_no),p_mode,round(coalesce(p_value,0),4),round(coalesce(p_amount,0),2),auth.uid(),now())
on conflict(company_id,business_unit_id,document_type,document_no) do update set discount_mode=excluded.discount_mode,discount_value=excluded.discount_value,discount_amount=excluded.discount_amount,updated_at=now();
return jsonb_build_object('success',true,'discount_amount',round(coalesce(p_amount,0),2));
end $$;
grant execute on function public.upsert_commercial_invoice_discount(text,text,text,numeric,numeric) to authenticated;


create or replace function public.discount_amount_for(p_type text,p_no text)
returns numeric language sql stable security definer set search_path='public','pg_temp' as $
 select coalesce((select discount_amount from public.commercial_invoice_discounts where company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and document_type=p_type and document_no=p_no limit 1),0)::numeric
$;
revoke all on function public.discount_amount_for(text,text) from public,anon,authenticated;

create or replace function public.apply_document_discount_total()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_own numeric:=0; v_linked numeric:=0; v_type text:=TG_ARGV[0]; v_no text;
begin
 v_no:=case when TG_TABLE_NAME in ('sales_orders','purchase_orders') then coalesce(NEW.order_no,'') else coalesce(NEW.invoice_no,'') end;
 select coalesce(discount_amount,0) into v_own from public.commercial_invoice_discounts where company_id=NEW.company_id and business_unit_id=NEW.business_unit_id and document_type=v_type and document_no=v_no limit 1;
 if NEW.status='posted' and TG_TABLE_NAME='sales_orders' then
   select coalesce(sum(d.discount_amount),0) into v_linked from public.sales_order_hawala_invoices l join public.consolidated_sales_invoices h on h.id=l.hawala_invoice_id join public.commercial_invoice_discounts d on d.company_id=NEW.company_id and d.business_unit_id=NEW.business_unit_id and d.document_type='sales_consolidated' and d.document_no=h.invoice_no where l.sales_order_id=NEW.id and l.company_id=NEW.company_id and l.business_unit_id=NEW.business_unit_id;
 elsif NEW.status='posted' and TG_TABLE_NAME='purchase_orders' then
   select coalesce(sum(d.discount_amount),0) into v_linked from public.purchase_order_consolidated_invoices l join public.consolidated_purchase_invoices h on h.id=l.consolidated_invoice_id join public.commercial_invoice_discounts d on d.company_id=NEW.company_id and d.business_unit_id=NEW.business_unit_id and d.document_type='purchase_consolidated' and d.document_no=h.invoice_no where l.purchase_order_id=NEW.id and l.company_id=NEW.company_id and l.business_unit_id=NEW.business_unit_id;
 end if;
 NEW.total:=greatest(round(coalesce(NEW.total,0)-v_own-v_linked,2),0); return NEW;
end $$;

drop trigger if exists trg_sales_order_discount_total on public.sales_orders;
create trigger trg_sales_order_discount_total before insert or update of total,status on public.sales_orders for each row execute function public.apply_document_discount_total('sales_main');
drop trigger if exists trg_consolidated_sales_discount_total on public.consolidated_sales_invoices;
create trigger trg_consolidated_sales_discount_total before insert or update of total,status on public.consolidated_sales_invoices for each row execute function public.apply_document_discount_total('sales_consolidated');
drop trigger if exists trg_purchase_order_discount_total on public.purchase_orders;
create trigger trg_purchase_order_discount_total before insert or update of total,status on public.purchase_orders for each row execute function public.apply_document_discount_total('purchase_main');
drop trigger if exists trg_consolidated_purchase_discount_total on public.consolidated_purchase_invoices;
create trigger trg_consolidated_purchase_discount_total before insert or update of total,status on public.consolidated_purchase_invoices for each row execute function public.apply_document_discount_total('purchase_consolidated');


create or replace function public.post_sales_discount_adjustment()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_own numeric:=0; v_linked numeric:=0; v_discount numeric:=0; v_disc_ac uuid; v_ar uuid; v_customer_ac uuid; v_customer_name text; v_je uuid; v_no text;
begin
 if NEW.status<>'posted' or OLD.status='posted' then return NEW; end if;
 select coalesce(discount_amount,0) into v_own from public.commercial_invoice_discounts where company_id=NEW.company_id and business_unit_id=NEW.business_unit_id and document_type='sales_main' and document_no=NEW.order_no limit 1;
 select coalesce(sum(d.discount_amount),0) into v_linked from public.sales_order_hawala_invoices l join public.consolidated_sales_invoices h on h.id=l.hawala_invoice_id join public.commercial_invoice_discounts d on d.company_id=NEW.company_id and d.business_unit_id=NEW.business_unit_id and d.document_type='sales_consolidated' and d.document_no=h.invoice_no where l.sales_order_id=NEW.id and l.company_id=NEW.company_id and l.business_unit_id=NEW.business_unit_id;
 v_discount:=round(v_own+v_linked,2); if v_discount<=0 then return NEW; end if;
 perform public.ensure_commercial_discount_accounts();
 select account_id into v_disc_ac from public.account_mappings where company_id=NEW.company_id and mapping_key='sales_discount_allowed' limit 1;
 select account_id into v_ar from public.account_mappings where company_id=NEW.company_id and mapping_key='accounts_receivable' limit 1;
 if NEW.customer_id is not null then select name,account_id into v_customer_name,v_customer_ac from public.customers where id=NEW.customer_id and company_id=NEW.company_id; end if;
 v_ar:=coalesce(v_customer_ac,v_ar); if v_disc_ac is null or v_ar is null then raise exception 'Discount Allowed or Accounts Receivable mapping is missing.'; end if;
 v_no:='DISC-S-'||NEW.order_no;
 if exists(select 1 from public.journal_entries where company_id=NEW.company_id and entry_no=v_no) then return NEW; end if;
 insert into public.journal_entries(user_id,company_id,business_unit_id,entry_no,entry_date,description,status,party_name,trans_type)
 values(NEW.user_id,NEW.company_id,NEW.business_unit_id,v_no,NEW.order_date,'Discount Allowed — Sales Invoice '||NEW.order_no,'draft',v_customer_name,'Sales Discount') returning id into v_je;
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit)
 select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,v_discount,0 from public.chart_of_accounts where id=v_disc_ac;
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name,party_type,party_id)
 select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,0,v_discount,v_customer_name,'customer',NEW.customer_id from public.chart_of_accounts where id=v_ar;
 perform public.post_journal_entry(v_je);
 if NEW.customer_id is not null then
   insert into public.party_ledgers(user_id,company_id,business_unit_id,party_type,party_id,entry_date,description,reference,debit,credit,balance,journal_entry_id)
   values(NEW.user_id,NEW.company_id,NEW.business_unit_id,'customer',NEW.customer_id,NEW.order_date,'Discount Allowed — '||NEW.order_no,v_no,0,v_discount,-v_discount,v_je);
 end if;
 update public.sales_orders set outstanding_amount=greatest(coalesce(total,0)-coalesce(paid_amount,0),0),payment_status=case when coalesce(paid_amount,0)>=coalesce(total,0) then 'paid' when coalesce(paid_amount,0)>0 then 'partial' else 'unpaid' end where id=NEW.id;
 return NEW;
end $$;
drop trigger if exists trg_post_sales_discount_adjustment on public.sales_orders;
create trigger trg_post_sales_discount_adjustment after update of status on public.sales_orders for each row execute function public.post_sales_discount_adjustment();

create or replace function public.post_purchase_discount_adjustment()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_own numeric:=0; v_linked numeric:=0; v_discount numeric:=0; v_disc_ac uuid; v_ap uuid; v_supplier_ac uuid; v_supplier_name text; v_je uuid; v_no text;
begin
 if NEW.status<>'posted' or OLD.status='posted' then return NEW; end if;
 select coalesce(discount_amount,0) into v_own from public.commercial_invoice_discounts where company_id=NEW.company_id and business_unit_id=NEW.business_unit_id and document_type='purchase_main' and document_no=NEW.order_no limit 1;
 select coalesce(sum(d.discount_amount),0) into v_linked from public.purchase_order_consolidated_invoices l join public.consolidated_purchase_invoices h on h.id=l.consolidated_invoice_id join public.commercial_invoice_discounts d on d.company_id=NEW.company_id and d.business_unit_id=NEW.business_unit_id and d.document_type='purchase_consolidated' and d.document_no=h.invoice_no where l.purchase_order_id=NEW.id and l.company_id=NEW.company_id and l.business_unit_id=NEW.business_unit_id;
 v_discount:=round(v_own+v_linked,2); if v_discount<=0 then return NEW; end if;
 perform public.ensure_commercial_discount_accounts();
 select account_id into v_disc_ac from public.account_mappings where company_id=NEW.company_id and mapping_key='purchase_discount_received' limit 1;
 select account_id into v_ap from public.account_mappings where company_id=NEW.company_id and mapping_key='accounts_payable' limit 1;
 if NEW.supplier_id is not null then select name,account_id into v_supplier_name,v_supplier_ac from public.suppliers where id=NEW.supplier_id and company_id=NEW.company_id; end if;
 v_ap:=coalesce(v_supplier_ac,v_ap); if v_disc_ac is null or v_ap is null then raise exception 'Discount Received or Accounts Payable mapping is missing.'; end if;
 v_no:='DISC-P-'||NEW.order_no;
 if exists(select 1 from public.journal_entries where company_id=NEW.company_id and entry_no=v_no) then return NEW; end if;
 insert into public.journal_entries(user_id,company_id,business_unit_id,entry_no,entry_date,description,status,party_name,trans_type)
 values(NEW.user_id,NEW.company_id,NEW.business_unit_id,v_no,NEW.order_date,'Discount Received — Purchase Invoice '||NEW.order_no,'draft',v_supplier_name,'Purchase Discount') returning id into v_je;
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name,party_type,party_id)
 select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,v_discount,0,v_supplier_name,'supplier',NEW.supplier_id from public.chart_of_accounts where id=v_ap;
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit)
 select NEW.user_id,NEW.company_id,NEW.business_unit_id,v_je,code||' - '||name,id,0,v_discount from public.chart_of_accounts where id=v_disc_ac;
 perform public.post_journal_entry(v_je);
 return NEW;
end $$;
drop trigger if exists trg_post_purchase_discount_adjustment on public.purchase_orders;
create trigger trg_post_purchase_discount_adjustment after update of status on public.purchase_orders for each row execute function public.post_purchase_discount_adjustment();
