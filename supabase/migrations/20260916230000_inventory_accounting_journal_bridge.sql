create or replace function public.create_inventory_accounting_journal(p_queue_id uuid)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare q public.inventory_accounting_queue%rowtype; d public.inventory_control_documents%rowtype;
 v_entry_id uuid; v_entry_no text; v_user uuid:=public.legacy_data_user_id(); v_debit_name text; v_credit_name text;
begin
 perform public.assert_module_permission('accounting','create');
 select * into q from public.inventory_accounting_queue where id=p_queue_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Accounting queue item not found.'; end if;
 if q.status<>'ready' then raise exception 'Queue item must be ready. Current status: %.',q.status; end if;
 if q.amount<=0 or q.debit_account_id is null or q.credit_account_id is null then raise exception 'Valid amount and both account mappings are required.'; end if;
 if q.debit_account_id=q.credit_account_id then raise exception 'Debit and credit accounts must be different.'; end if;
 select * into d from public.inventory_control_documents where id=q.document_id;
 select name into v_debit_name from public.chart_of_accounts where id=q.debit_account_id and company_id=q.company_id and is_active=true and is_group=false;
 select name into v_credit_name from public.chart_of_accounts where id=q.credit_account_id and company_id=q.company_id and is_active=true and is_group=false;
 if v_debit_name is null or v_credit_name is null then raise exception 'Mapped posting accounts must be active leaf accounts.'; end if;
 v_entry_id:=gen_random_uuid(); v_entry_no:='INV-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(v_entry_id::text,'-',''),1,8));
 insert into public.journal_entries(id,user_id,entry_no,entry_date,description,status,company_id,business_unit_id,created_by,source_module,source_document_type,source_document_id)
 values(v_entry_id,v_user,v_entry_no,d.document_date,'Inventory posting: '||d.document_no,'draft',q.company_id,q.business_unit_id,auth.uid(),'inventory',d.document_type,d.id);
 insert into public.journal_lines(user_id,entry_id,account,debit,credit,account_id,company_id,business_unit_id,base_debit,base_credit)
 values
 (v_user,v_entry_id,v_debit_name,round(q.amount,2),0,q.debit_account_id,q.company_id,q.business_unit_id,round(q.amount,2),0),
 (v_user,v_entry_id,v_credit_name,0,round(q.amount,2),q.credit_account_id,q.company_id,q.business_unit_id,0,round(q.amount,2));
 update public.inventory_accounting_queue set status='journal_created',journal_entry_id=v_entry_id,updated_at=now() where id=q.id;
 return v_entry_id;
end $$;

revoke all on function public.create_inventory_accounting_journal(uuid) from public,anon;
grant execute on function public.create_inventory_accounting_journal(uuid) to authenticated;
