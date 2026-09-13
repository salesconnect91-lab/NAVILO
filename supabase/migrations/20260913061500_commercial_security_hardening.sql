-- Commercial SaaS hardening: minimize direct helper RPC exposure,
-- enforce read permissions, and make company test-data reset preserve master/config records.

revoke execute on function public.assert_module_permission(text,text) from authenticated, anon;
revoke execute on function public.next_document_number(text,text) from authenticated, anon;
-- legacy_data_user_id is used by RLS policies and must remain executable by authenticated users.
grant execute on function public.legacy_data_user_id() to authenticated;
revoke execute on function public.legacy_data_user_id() from anon;

create or replace function public.get_accounting_integrity_summary()
returns table(check_key text, status text, amount numeric, details jsonb)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
begin
  if auth.uid() is null or v_company is null or v_bu is null then raise exception 'Authentication, active company and business unit are required.'; end if;
  if not public.has_module_permission(v_company,'accounting','view') then raise exception 'Accounting view permission required.'; end if;
  return query
  with posted as (
    select je.id,coalesce(sum(jl.debit),0) debit,coalesce(sum(jl.credit),0) credit
    from public.journal_entries je join public.journal_lines jl on jl.entry_id=je.id
    where je.company_id=v_company and je.business_unit_id=v_bu and je.status='posted'
    group by je.id
  ), imbal as (
    select count(*) cnt,coalesce(sum(abs(debit-credit)),0) diff from posted where abs(debit-credit)>=0.01
  ), stock as (
    select coalesce(sum(ws.quantity*coalesce(ic.avg_cost,0)),0) value
    from public.warehouse_stock ws
    left join public.inventory_costs ic on ic.company_id=ws.company_id and ic.business_unit_id=ws.business_unit_id and ic.item_id=ws.item_id
    where ws.company_id=v_company and ws.business_unit_id=v_bu
  ), orph as (
    select count(*) cnt from public.journal_entries je
    where je.company_id=v_company and je.business_unit_id=v_bu and je.status='posted'
      and not exists(select 1 from public.journal_lines jl where jl.entry_id=je.id)
  )
  select 'journal_balance'::text,case when imbal.cnt=0 then 'ok' else 'error' end,imbal.diff,jsonb_build_object('unbalanced_entries',imbal.cnt) from imbal
  union all
  select 'orphan_posted_journals',case when orph.cnt=0 then 'ok' else 'error' end,orph.cnt::numeric,jsonb_build_object('count',orph.cnt) from orph
  union all
  select 'stock_valuation','info',stock.value,jsonb_build_object('note','Inventory valuation based on current average cost') from stock;
end
$function$;

create or replace function public.get_available_consolidated_purchase_invoices(p_supplier_id uuid, p_order_id uuid default null::uuid)
returns table(id uuid, invoice_no text, invoice_date date, reference_name text, reference_no text, total numeric, linked_purchase_order_id uuid, invoice_type text)
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
begin
  if auth.uid() is null or v_company is null or v_bu is null then raise exception 'Authentication, active company and business unit are required.'; end if;
  if not public.has_module_permission(v_company,'purchase','view') then raise exception 'Purchase view permission required.'; end if;
  return query
  select h.id,h.invoice_no,h.invoice_date,h.reference_name,h.reference_no,h.total,l.purchase_order_id,h.invoice_type
  from public.consolidated_purchase_invoices h
  left join public.purchase_order_consolidated_invoices l on l.consolidated_invoice_id=h.id and l.company_id=v_company and l.business_unit_id=v_bu
  left join public.purchase_orders po on po.id=p_order_id and po.company_id=v_company and po.business_unit_id=v_bu
  where h.company_id=v_company and h.business_unit_id=v_bu and h.status='posted'
    and h.supplier_id=p_supplier_id
    and (p_order_id is null or po.id is not null)
    and (p_order_id is null or coalesce(h.invoice_type,'Purchase Invoice')=coalesce(po.invoice_type,'Purchase Invoice'))
    and (l.purchase_order_id is null or l.purchase_order_id=p_order_id)
  order by h.invoice_date,h.invoice_no;
end
$function$;

create or replace function public.get_gate_pass_weighbridge_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_result jsonb;
begin
  if auth.uid() is null or v_company is null or v_bu is null then raise exception 'Authentication, active company and business unit are required.'; end if;
  if not (public.has_module_permission(v_company,'production','view') or public.has_module_permission(v_company,'settings','view')) then raise exception 'Production or Settings view permission required.'; end if;
  select coalesce(settings->'gate_pass_weighbridge',jsonb_build_object('tolerance_mode','greater_of_both','fixed_tolerance_kg',1,'percentage_tolerance',0.5))
  into v_result from public.business_units where id=v_bu and company_id=v_company;
  return coalesce(v_result,jsonb_build_object('tolerance_mode','greater_of_both','fixed_tolerance_kg',1,'percentage_tolerance',0.5));
end
$function$;

create or replace function public.platform_preview_company_transaction_reset(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_company record; v_total bigint:=0; v_count bigint; v_counts jsonb:='{}'::jsonb; v_table text;
  v_tables text[]:=array['sales_orders','purchase_orders','work_orders','stock_movements','warehouse_stock','party_ledgers','ledgers','journal_entries','return_notes','consolidated_sales_invoices','consolidated_purchase_invoices','order_book_allocations','order_book_fulfillments','employee_salary_accruals','employee_salary_payments','loan_party_transactions','fixed_asset_depreciation','transaction_attachments','transaction_links'];
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  select id,name,code into v_company from public.companies where id=p_company_id; if not found then raise exception 'Company not found'; end if;
  foreach v_table in array v_tables loop
    if to_regclass('public.'||v_table) is not null then
      if v_table='journal_entries' then execute 'select count(*) from public.journal_entries where company_id=$1 and coalesce(trans_type,'''')<>''opening_balance''' into v_count using p_company_id;
      elsif v_table in ('party_ledgers','ledgers') then execute format('select count(*) from public.%I x where company_id=$1 and (journal_entry_id is null or not exists(select 1 from public.journal_entries j where j.id=x.journal_entry_id and j.company_id=$1 and j.trans_type=''opening_balance''))',v_table) into v_count using p_company_id;
      else execute format('select count(*) from public.%I where company_id=$1',v_table) into v_count using p_company_id; end if;
      if v_count>0 then v_counts:=v_counts||jsonb_build_object(v_table,v_count);v_total:=v_total+v_count;end if;
    end if;
  end loop;
  select count(*) into v_count from public.order_book_headers where company_id=p_company_id and not is_opening_import;
  if v_count>0 then v_counts:=v_counts||jsonb_build_object('operational_order_book_headers',v_count);v_total:=v_total+v_count;end if;
  return jsonb_build_object('company',jsonb_build_object('id',v_company.id,'name',v_company.name,'code',v_company.code),'total_rows',v_total,'counts',v_counts,'preserved',jsonb_build_array('Company, business units, branches, users and permissions','Master data and warehouses/godowns','Chart of Accounts, mappings, tax, charges and settings','Fixed asset master records and budgets','Employee salary profiles and loan parties','Opening party balance journals and their ledger effect','Imported opening Sales/Purchase Order Book baseline','Security configuration and platform audit history'));
end
$function$;

create or replace function public.platform_reset_company_transactions(p_company_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_company record; v_total bigint:=0; v_count bigint; v_deleted jsonb:='{}'::jsonb; v_table text;
  v_tables text[]:=array['transaction_attachments','transaction_links','bank_reconciliation_items','employee_salary_payments','employee_salary_accruals','loan_party_transactions','fixed_asset_depreciation','fiscal_year_opening_balances','invoice_payment_allocations','purchase_payment_allocations','return_note_lines','return_notes','hawala_pending_stock','sales_order_hawala_invoices','sales_consolidation_invoices','sales_consolidations','purchase_order_consolidated_invoices','consolidated_sales_invoice_charges','consolidated_sales_invoice_lines','consolidated_sales_invoices','consolidated_purchase_invoice_charges','consolidated_purchase_invoice_lines','purchase_order_lines','consolidated_purchase_invoices','sales_order_charges','sales_order_lines','work_order_lines','gate_passes','cutting_orders','furnace_yields','stock_movements','warehouse_stock','inventory_costs','bank_reconciliations','fiscal_year_closures','sales_orders','purchase_orders','work_orders'];
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  select id,name,code into v_company from public.companies where id=p_company_id for update; if not found then raise exception 'Company not found'; end if;
  perform set_config('app.maintenance_reset','1',true);
  update public.journal_entries set fiscal_year_closure_id=null,reversal_of_entry_id=null where company_id=p_company_id and coalesce(trans_type,'')<>'opening_balance';
  update public.fiscal_year_closures set closing_journal_id=null where company_id=p_company_id;
  delete from public.order_book_allocations where company_id=p_company_id; get diagnostics v_count=row_count; if v_count>0 then v_deleted:=v_deleted||jsonb_build_object('order_book_allocations',v_count);v_total:=v_total+v_count;end if;
  delete from public.order_book_fulfillments where company_id=p_company_id; get diagnostics v_count=row_count; if v_count>0 then v_deleted:=v_deleted||jsonb_build_object('order_book_fulfillments',v_count);v_total:=v_total+v_count;end if;
  delete from public.order_book_qty_history where company_id=p_company_id; delete from public.order_book_rate_history where company_id=p_company_id; delete from public.order_book_cancellation_history where company_id=p_company_id;
  delete from public.order_book_headers where company_id=p_company_id and not is_opening_import; get diagnostics v_count=row_count; if v_count>0 then v_deleted:=v_deleted||jsonb_build_object('operational_order_book_headers',v_count);v_total:=v_total+v_count;end if;
  update public.order_book_commitments set ordered_qty=opening_ordered_qty,fulfilled_qty=opening_fulfilled_qty,cancelled_qty=opening_cancelled_qty,rate_status=opening_rate_status,agreed_rate=opening_agreed_rate,effective_at=opening_effective_at,status=opening_status,remarks=opening_remarks,updated_at=now() where company_id=p_company_id and is_opening_import;
  update public.order_book_headers set status=coalesce(opening_status,status),remarks=opening_remarks,cancellation_reason=null,cancelled_at=null,cancelled_by=null,updated_at=now() where company_id=p_company_id and is_opening_import;
  foreach v_table in array v_tables loop if to_regclass('public.'||v_table) is not null then execute format('delete from public.%I where company_id=$1',v_table) using p_company_id; get diagnostics v_count=row_count; if v_count>0 then v_deleted:=v_deleted||jsonb_build_object(v_table,v_count);v_total:=v_total+v_count;end if; end if; end loop;
  delete from public.party_ledgers where company_id=p_company_id and (journal_entry_id is null or not exists(select 1 from public.journal_entries j where j.id=party_ledgers.journal_entry_id and j.company_id=p_company_id and j.trans_type='opening_balance'));
  delete from public.ledgers where company_id=p_company_id and (journal_entry_id is null or not exists(select 1 from public.journal_entries j where j.id=ledgers.journal_entry_id and j.company_id=p_company_id and j.trans_type='opening_balance'));
  delete from public.journal_lines where company_id=p_company_id and not exists(select 1 from public.journal_entries j where j.id=journal_lines.entry_id and j.company_id=p_company_id and j.trans_type='opening_balance');
  delete from public.journal_entries where company_id=p_company_id and coalesce(trans_type,'')<>'opening_balance';
  insert into public.platform_audit_logs(actor_user_id,company_id,action,target_type,target_id,details) values(p_actor_id,p_company_id,'company_transaction_data_reset','company',p_company_id,jsonb_build_object('company_name',v_company.name,'company_code',v_company.code,'deleted_rows',v_total,'deleted_by_table',v_deleted,'preserved','master/config/security/audit + fixed assets/budgets + salary profiles/loan parties + opening balances + imported opening order book baselines'));
  return jsonb_build_object('success',true,'company',jsonb_build_object('id',v_company.id,'name',v_company.name,'code',v_company.code),'deleted_rows',v_total,'deleted',v_deleted,'preserved',jsonb_build_array('Master/config/security/audit data','Fixed asset master records and budgets','Employee salary profiles and loan parties','Opening party balance journals and ledgers','Imported opening Sales/Purchase Order Book baselines'));
end
$function$;

revoke execute on function public.platform_preview_company_transaction_reset(uuid) from public, anon, authenticated;
revoke execute on function public.platform_reset_company_transactions(uuid,uuid) from public, anon, authenticated;
grant execute on function public.platform_preview_company_transaction_reset(uuid) to service_role;
grant execute on function public.platform_reset_company_transactions(uuid,uuid) to service_role;
