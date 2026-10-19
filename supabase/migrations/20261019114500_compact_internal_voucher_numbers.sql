-- Future-only compact internal document references (audit-safe).
-- Original invoice numbers, Trip numbers, posted history, and UUID primary keys are unchanged.
-- Avoid truncated-UUID collisions by using company + business-unit scoped document_sequences.
begin;
alter table public.document_sequences alter column padding set default 4;
-- A prefix without a year must never reset, otherwise duplicate vouchers would be produced next fiscal year.
alter table public.document_sequences alter column reset_policy set default 'never';
update public.document_sequences
   set padding=4,reset_policy='never',updated_at=now()
 where document_type in ('manual_journal','sales','purchase','expense_invoice','inventory_journal','cash_bank','salary_payment')
   and (padding<>4 or reset_policy<>'never');

do $compact$
declare r record; original_definition text; changed_definition text;
begin
 for r in select * from (values
    ('public.general_expense_bill_create(uuid,date,text,uuid,jsonb,boolean,boolean,text)','number:=''EXP-''||upper(substr(replace(gen_random_uuid()::text,''-'',''''),1,16));','number:=public.next_document_number(''expense_invoice'',''EXP-'');'),
    ('public.create_inventory_accounting_journal(uuid)','v_entry_id:=gen_random_uuid(); v_entry_no:=''INV-''||to_char(current_date,''YYYYMMDD'')||''-''||upper(substr(replace(v_entry_id::text,''-'',''''),1,8));','v_entry_id:=gen_random_uuid(); v_entry_no:=public.next_document_number(''inventory_journal'',''IV-'');'),
    ('public.post_general_cash_bank_transaction(date,text,uuid,uuid,numeric,text,text,text)','v_entry_no := ''GCB-'' || upper(substr(replace(gen_random_uuid()::text,''-'',''''),1,10));','v_entry_no := public.next_document_number(''cash_bank'',''CB-'');'),
    ('public.post_salary_payment(uuid,date,date,uuid,uuid,numeric,text,text)','jno:=''SAL-PAY-''||upper(substr(replace(je::text,''-'',''''),1,10));','jno:=public.next_document_number(''salary_payment'',''SAL-'');'),
    ('public.post_salary_payment_before_salary_link(uuid,date,date,uuid,uuid,numeric,text,text)','v_no:=''SAL-PAY-''||upper(substr(replace(v_je::text,''-'',''''),1,10));','v_no:=public.next_document_number(''salary_payment'',''SAL-'');')
 ) as changes(signature,search_text,replacement_text) loop
  select pg_get_functiondef(to_regprocedure(r.signature)) into original_definition;
  if original_definition is null then
     raise exception 'Compact reference upgrade: function not found: %',r.signature;
  end if;
  if position(r.search_text in original_definition)=0 then
     if position(r.replacement_text in original_definition)>0 then continue;end if;
     raise exception 'Compact reference upgrade: audited expression changed in %',r.signature;
  end if;
  changed_definition:=replace(original_definition,r.search_text,r.replacement_text);
  execute changed_definition;
 end loop;
end $compact$;
commit;
