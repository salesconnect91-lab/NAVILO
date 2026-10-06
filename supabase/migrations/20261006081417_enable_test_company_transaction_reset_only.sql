-- Synced from verified production migration 20261006081417 (enable_test_company_transaction_reset_only).
create or replace function public.platform_preview_company_transaction_reset(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company record; v_counts jsonb='{}'::jsonb; v_total bigint=0; v_count bigint; v_table text;
v_tables text[]:=array['sales_orders','purchase_orders','work_orders','stock_movements','warehouse_stock','party_ledgers','ledgers','journal_entries','return_notes','consolidated_sales_invoices','consolidated_purchase_invoices','order_book_allocations','order_book_fulfillments','employee_salary_accruals','employee_salary_payments','loan_party_transactions','fixed_asset_depreciation','transaction_attachments','transaction_links','transport_cash_sale_requests','transport_cost_upload_requests','transport_customer_document_trips','transport_customer_documents','transport_driver_accrual_attributions','transport_driver_expenses','transport_driver_payment_attributions','transport_financial_assignment_history','transport_history_import_jobs','transport_rate_adjustments','transport_reversed_allocation_evidence','transport_service_cost_links','transport_service_note_lines','transport_service_refunds','transport_settlement_requests','transport_supplier_document_rents','transport_supplier_documents','transport_trip_assignments','transport_trip_audit','transport_trip_customer_charges','transport_trip_entry_requests','transport_trip_expenses','transport_trip_import_jobs','transport_trip_locations','transport_trip_number_registry','transport_trip_supplier_charges','transport_trip_supplier_rents','transport_trips'];
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 select id,name,code,is_test_company into v_company from public.companies where id=p_company_id;
 if not found then raise exception 'Company not found'; end if;
 if not coalesce(v_company.is_test_company,false) then raise exception 'Transaction reset is allowed only for an explicitly marked Test Company'; end if;
 foreach v_table in array v_tables loop
  if to_regclass('public.'||v_table) is not null then
   if v_table='journal_entries' then execute 'select count(*) from public.journal_entries where company_id=$1 and coalesce(trans_type,'''')<>''opening_balance''' into v_count using p_company_id;
   elsif v_table in ('party_ledgers','ledgers') then execute format('select count(*) from public.%I x where company_id=$1 and (journal_entry_id is null or not exists(select 1 from public.journal_entries j where j.id=x.journal_entry_id and j.company_id=$1 and j.trans_type=''opening_balance''))',v_table) into v_count using p_company_id;
   else execute format('select count(*) from public.%I where company_id=$1',v_table) into v_count using p_company_id; end if;
   if v_count>0 then v_counts:=v_counts||jsonb_build_object(v_table,v_count); v_total:=v_total+v_count; end if;
  end if;
 end loop;
 return jsonb_build_object('company',jsonb_build_object('id',v_company.id,'name',v_company.name,'code',v_company.code),'total_rows',v_total,'counts',v_counts,'preserved',jsonb_build_array('Company, business units, branches, users and permissions','Master data including Transport vehicles/drivers/locations/types','Chart of Accounts, mappings, tax, charges, rates and settings','Opening party balance journals and their ledger effect','Imported opening Sales/Purchase Order Book baseline','Security configuration and platform audit history'));
end $$;

create or replace function public.platform_reset_company_transactions(p_company_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company record; v_count bigint; v_total bigint:=0; v_deleted jsonb='{}'::jsonb; v_table text; v_pass int:=0; v_progress bigint;
v_tables text[]:=array['transaction_attachments','transaction_links','transport_customer_document_trips','transport_supplier_document_rents','transport_driver_payment_attributions','transport_driver_accrual_attributions','transport_reversed_allocation_evidence','transport_service_cost_links','transport_service_note_lines','transport_service_refunds','transport_settlement_requests','transport_trip_customer_charges','transport_trip_supplier_charges','transport_trip_expenses','transport_trip_assignments','transport_trip_audit','transport_trip_locations','transport_cash_sale_requests','transport_cost_upload_requests','transport_customer_documents','transport_supplier_documents','transport_financial_assignment_history','transport_history_import_jobs','transport_rate_adjustments','transport_trip_entry_requests','transport_trip_import_jobs','transport_trip_number_registry','transport_trip_supplier_rents','transport_driver_expenses','transport_trips','bank_reconciliation_items','employee_salary_payments','employee_salary_accruals','loan_party_transactions','fixed_asset_depreciation','fiscal_year_opening_balances','invoice_payment_allocations','purchase_payment_allocations','return_note_lines','return_notes','hawala_pending_stock','sales_order_hawala_invoices','sales_consolidation_invoices','sales_consolidations','purchase_order_consolidated_invoices','consolidated_sales_invoice_charges','consolidated_sales_invoice_lines','consolidated_sales_invoices','consolidated_purchase_invoice_charges','consolidated_purchase_invoice_lines','purchase_order_lines','consolidated_purchase_invoices','sales_order_charges','sales_order_lines','work_order_lines','gate_passes','cutting_orders','furnace_yields','stock_movements','warehouse_stock','inventory_costs','bank_reconciliations','fiscal_year_closures','sales_orders','purchase_orders','work_orders'];
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 select id,name,code,is_test_company into v_company from public.companies where id=p_company_id for update;
 if not found then raise exception 'Company not found'; end if;
 if not coalesce(v_company.is_test_company,false) then raise exception 'Transaction reset is allowed only for an explicitly marked Test Company'; end if;
 perform set_config('app.maintenance_reset','1',true);
 update public.journal_entries set fiscal_year_closure_id=null,reversal_of_entry_id=null where company_id=p_company_id and coalesce(trans_type,'')<>'opening_balance';
 update public.fiscal_year_closures set closing_journal_id=null where company_id=p_company_id;
 delete from public.order_book_allocations where company_id=p_company_id;
 delete from public.order_book_fulfillments where company_id=p_company_id;
 delete from public.order_book_qty_history where company_id=p_company_id;
 delete from public.order_book_rate_history where company_id=p_company_id;
 delete from public.order_book_cancellation_history where company_id=p_company_id;
 delete from public.order_book_headers where company_id=p_company_id and not is_opening_import;
 update public.order_book_commitments set ordered_qty=opening_ordered_qty,fulfilled_qty=opening_fulfilled_qty,cancelled_qty=opening_cancelled_qty,rate_status=opening_rate_status,agreed_rate=opening_agreed_rate,effective_at=opening_effective_at,status=opening_status,remarks=opening_remarks,updated_at=now() where company_id=p_company_id and is_opening_import;
 update public.order_book_headers set status=coalesce(opening_status,status),remarks=opening_remarks,cancellation_reason=null,cancelled_at=null,cancelled_by=null,updated_at=now() where company_id=p_company_id and is_opening_import;
 loop
  v_pass:=v_pass+1; v_progress:=0;
  foreach v_table in array v_tables loop
   if to_regclass('public.'||v_table) is not null then
    begin execute format('delete from public.%I where company_id=$1',v_table) using p_company_id; get diagnostics v_count=row_count;
     if v_count>0 then v_progress:=v_progress+v_count; v_total:=v_total+v_count; v_deleted:=v_deleted||jsonb_build_object(v_table,coalesce((v_deleted->>v_table)::bigint,0)+v_count); end if;
    exception when foreign_key_violation or raise_exception then null; end;
   end if;
  end loop;
  exit when v_progress=0 or v_pass>=20;
 end loop;
 delete from public.party_ledgers where company_id=p_company_id and (journal_entry_id is null or not exists(select 1 from public.journal_entries j where j.id=party_ledgers.journal_entry_id and j.company_id=p_company_id and j.trans_type='opening_balance'));
 delete from public.ledgers where company_id=p_company_id and (journal_entry_id is null or not exists(select 1 from public.journal_entries j where j.id=ledgers.journal_entry_id and j.company_id=p_company_id and j.trans_type='opening_balance'));
 delete from public.journal_lines where company_id=p_company_id and not exists(select 1 from public.journal_entries j where j.id=journal_lines.entry_id and j.company_id=p_company_id and j.trans_type='opening_balance');
 delete from public.journal_entries where company_id=p_company_id and coalesce(trans_type,'')<>'opening_balance';
 insert into public.platform_audit_logs(actor_user_id,company_id,action,target_type,target_id,details) values(p_actor_id,p_company_id,'test_company_transaction_reset','company',p_company_id,jsonb_build_object('company_name',v_company.name,'company_code',v_company.code,'deleted_rows',v_total,'deleted_by_table',v_deleted));
 return jsonb_build_object('success',true,'deleted_rows',v_total,'deleted',v_deleted,'preserved',jsonb_build_array('Company and workspace structure','Master/config/security/audit data','Transport masters and rate setup','Opening party balances','Imported opening order book baselines'));
end $$;
revoke all on function public.platform_preview_company_transaction_reset(uuid) from public,anon,authenticated;
revoke all on function public.platform_reset_company_transactions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_preview_company_transaction_reset(uuid) to service_role;
grant execute on function public.platform_reset_company_transactions(uuid,uuid) to service_role;
