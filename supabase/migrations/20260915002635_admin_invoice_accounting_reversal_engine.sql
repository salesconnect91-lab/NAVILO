create or replace function public.create_admin_invoice_reversal_journal(p_document_type text,p_document_id uuid,p_reason text,p_reversal_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
 v_company uuid:=public.current_company_id(); v_unit uuid:=public.current_business_unit_id();
 v_original public.journal_entries%rowtype; v_reversal_id uuid; v_reversal_no text; v_doc_no text; v_post jsonb;
begin
 if v_company is null or v_unit is null then raise exception 'Active company and business unit are required.'; end if;
 perform public.assert_admin_posted_record_control(v_company);
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A correction reason is required.'; end if;
 if p_reversal_date is null then raise exception 'Reversal date is required.'; end if;
 perform public.admin_invoice_correction_preflight(p_document_type,p_document_id,p_reason);

 select * into v_original from public.journal_entries
 where company_id=v_company and business_unit_id=v_unit and source_document_id=p_document_id
   and source_document_type=case when lower(p_document_type)='sales' then 'sales_invoice' else 'purchase_invoice' end
   and status='posted' order by created_at limit 1 for update;
 if not found then raise exception 'Posted source journal was not found.'; end if;
 if p_reversal_date < v_original.entry_date then raise exception 'Reversal date cannot be earlier than the original journal date.'; end if;
 if exists(select 1 from public.journal_entries where company_id=v_company and business_unit_id=v_unit and reversal_of_entry_id=v_original.id) then raise exception 'The source journal has already been reversed.'; end if;

 v_doc_no:=case when lower(p_document_type)='sales' then replace(v_original.entry_no,'REV-','') else replace(v_original.entry_no,'PUR-','') end;
 v_reversal_no:='CORR-REV-'||v_original.entry_no||'-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,reversal_of_entry_id,reversal_reason,source_module,source_document_type,source_document_id)
 values(v_original.user_id,v_company,v_unit,v_original.operating_location_id,v_reversal_no,p_reversal_date,'Admin correction reversal of '||v_original.entry_no||' - '||btrim(p_reason),'draft',v_original.payment_mode,v_original.party_name,'Invoice Correction Reversal',v_original.id,btrim(p_reason),case when lower(p_document_type)='sales' then 'sales' else 'purchase' end,case when lower(p_document_type)='sales' then 'sales_invoice' else 'purchase_invoice' end,p_document_id)
 returning id into v_reversal_id;

 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,party_type,party_id,party_name,debit,credit,base_debit,base_credit)
 select jl.user_id,jl.company_id,jl.business_unit_id,jl.operating_location_id,v_reversal_id,jl.account_id,jl.account,jl.party_type,jl.party_id,jl.party_name,round(coalesce(jl.credit,0),2),round(coalesce(jl.debit,0),2),round(coalesce(jl.base_credit,jl.credit,0),2),round(coalesce(jl.base_debit,jl.debit,0),2)
 from public.journal_lines jl where jl.entry_id=v_original.id and jl.company_id=v_company and jl.business_unit_id=v_unit;
 if not found then raise exception 'Original invoice journal has no lines to reverse.'; end if;
 v_post:=public.post_journal_entry(v_reversal_id);
 perform public.log_admin_posted_action(v_company,case when lower(p_document_type)='sales' then 'sales' else 'purchase' end,'journal_entries',v_original.id,v_original.entry_no,'ACCOUNTING_REVERSAL_CREATED',p_reason,to_jsonb(v_original),jsonb_build_object('reversal_entry_id',v_reversal_id,'reversal_entry_no',v_reversal_no,'reversal_date',p_reversal_date));
 return jsonb_build_object('success',true,'document_id',p_document_id,'document_no',v_doc_no,'original_journal_id',v_original.id,'reversal_journal_id',v_reversal_id,'reversal_journal_no',v_reversal_no,'history_preserved',true,'post_result',v_post);
end;
$$;
revoke all on function public.create_admin_invoice_reversal_journal(text,uuid,text,date) from public;
grant execute on function public.create_admin_invoice_reversal_journal(text,uuid,text,date) to authenticated;
comment on function public.create_admin_invoice_reversal_journal(text,uuid,text,date) is 'Admin-only accounting reversal stage for traceable posted Sales/Purchase invoice correction. Creates and posts an opposite journal while preserving the original.';

