-- Safe owner cancellation for unallocated, base-currency accounting payment vouchers.
-- Allocated, transport-linked and FX payments remain protected for specialized correction.
create or replace function public.owner_cancel_unallocated_payment(
 p_entry_id uuid, p_reversal_date date, p_reason text
) returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
 v_company uuid:=public.current_company_id();
 v_bu uuid:=public.current_business_unit_id();
 v_location uuid:=public.current_operating_location_id();
 v_entry public.journal_entries%rowtype;
 v_currency text;
 v_result jsonb;
 v_reversal uuid;
begin
 if not public.owner_posted_control_access() then
   raise exception 'Company owner or platform owner required.';
 end if;
 if p_reversal_date is null or length(btrim(coalesce(p_reason,'')))<10 then
   raise exception 'Cancellation date and detailed reason required.';
 end if;
 select * into v_entry from public.journal_entries
 where id=p_entry_id and company_id=v_company and business_unit_id=v_bu
   and operating_location_id=v_location and status='posted' for update;
 if not found then raise exception 'Posted voucher not found in active branch.'; end if;
 if v_entry.trans_type not in ('Customer Receipt','Supplier Payment')
    or v_entry.source_module is distinct from 'accounting'
    or v_entry.source_document_type not in ('customer_receipt','supplier_payment')
    or v_entry.reversal_of_entry_id is not null
    or v_entry.fiscal_year_closure_id is not null
    or v_entry.monthly_profit_closure_id is not null then
   raise exception 'Voucher is not eligible for unallocated owner cancellation.';
 end if;
 select base_currency_code into v_currency from public.companies where id=v_company;
 if v_currency is null or coalesce(v_entry.currency_code,v_currency)<>v_currency
   or coalesce(v_entry.exchange_rate,1)<>1 then
   raise exception 'FX voucher requires specialized correction.';
 end if;
 if exists(select 1 from public.invoice_payment_allocations where journal_entry_id=p_entry_id)
    or exists(select 1 from public.purchase_payment_allocations where journal_entry_id=p_entry_id)
    or exists(select 1 from public.transport_canonical_party_movements where journal_entry_id=p_entry_id)
    or exists(select 1 from public.transport_party_movements where journal_entry_id=p_entry_id)
    or exists(select 1 from public.transport_party_advances where journal_entry_id=p_entry_id) then
   raise exception 'Allocated or transport-linked voucher requires specialized correction.';
 end if;
 if exists(select 1 from public.owner_posted_control_events where company_id=v_company
  and business_unit_id=v_bu and document_type='payment_voucher'
  and document_id=p_entry_id and action_type='cancel') then
   raise exception 'Voucher already cancelled.';
 end if;
 v_result:=public.reverse_payment_voucher(p_entry_id,p_reversal_date,btrim(p_reason));
 if coalesce((v_result->>'success')::boolean,false) is distinct from true then
   raise exception 'Canonical reversal did not confirm success.';
 end if;
 v_reversal:=nullif(v_result->>'reversal_entry_id','')::uuid;
 if v_reversal is null then raise exception 'Reversal journal missing.'; end if;
 insert into public.owner_posted_control_events(
   company_id,business_unit_id,document_type,document_id,action_type,
   reason,performed_by,reversal_document_id,metadata
 ) values (
   v_company,v_bu,'payment_voucher',p_entry_id,'cancel',
   btrim(p_reason),auth.uid(),v_reversal,
   jsonb_build_object('original_entry_no',v_entry.entry_no,
     'reversal_entry_no',v_result->>'reversal_entry_no',
     'voucher_type',v_entry.trans_type,'currency',v_currency)
 );
 return v_result || jsonb_build_object('owner_cancelled',true);
end;
$$;
revoke all on function public.owner_cancel_unallocated_payment(uuid,date,text) from public,anon;
grant execute on function public.owner_cancel_unallocated_payment(uuid,date,text) to authenticated;
create or replace function public.owner_cancelled_journal_ids()
returns table(entry_id uuid) language sql stable security definer
set search_path to 'public','pg_temp'
as $$
 select id from (
  select document_id as id from public.owner_posted_control_events
   where company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and action_type='cancel'
    and document_type in ('manual_journal','payment_voucher')
  union
  select reversal_document_id from public.owner_posted_control_events
   where company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and action_type='cancel'
    and document_type in ('manual_journal','payment_voucher')
    and reversal_document_id is not null
 ) q
 where auth.uid() is not null
   and public.has_module_permission(public.current_company_id(),'accounting','view');
$$;
revoke all on function public.owner_cancelled_journal_ids() from public,anon;
grant execute on function public.owner_cancelled_journal_ids() to authenticated;