-- Only active company/platform owners can reverse posted Journals or payment vouchers.
-- Manual reversal delegates to existing canonical audited owner cancellation.
BEGIN;
CREATE OR REPLACE FUNCTION public.reverse_manual_journal_entry(
 p_entry_id uuid,p_reversal_date date,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT public.owner_posted_control_access() THEN
   RAISE EXCEPTION 'Only the company owner or platform owner can reverse posted Journals.';
 END IF;
 result:=public.owner_cancel_manual_journal(p_entry_id,p_reversal_date,p_reason);
 RETURN result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.reverse_payment_voucher(p_journal_entry_id uuid, p_reversal_date date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := public.legacy_data_user_id();
  v_company uuid := public.current_company_id();
  v_bu uuid := public.current_business_unit_id();
  v_loc uuid := public.current_operating_location_id();
  v_actor uuid := auth.uid();
  v_src public.journal_entries%rowtype;
  v_rev uuid;
  v_rev_no text;
  v_next bigint;
  v_total numeric := 0;
begin
  if not public.owner_posted_control_access() then
    raise exception 'Only the company owner or platform owner can reverse posted vouchers.';
  end if;
  perform public.assert_module_permission('accounting','post');
  if v_uid is null or v_company is null or v_bu is null or v_loc is null or v_actor is null then
    raise exception 'Authentication and active company/business unit/branch are required.';
  end if;
  if p_journal_entry_id is null or p_reversal_date is null then raise exception 'Voucher and reversal date are required.'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Reversal reason is required.'; end if;

  select * into v_src
  from public.journal_entries
  where id=p_journal_entry_id
    and user_id=v_uid
    and company_id=v_company
    and business_unit_id=v_bu
    and operating_location_id=v_loc
    and status='posted'
  for update;
  if not found then raise exception 'Posted payment voucher was not found in the active branch.'; end if;
  if v_src.trans_type not in ('Customer Receipt','Supplier Payment') then raise exception 'Only Customer Receipt or Supplier Payment vouchers can be reversed here.'; end if;
  if p_reversal_date < v_src.entry_date then raise exception 'Reversal date cannot be earlier than original voucher date (%).',v_src.entry_date; end if;
  if exists(select 1 from public.journal_entries je where je.user_id=v_uid and je.company_id=v_company and je.business_unit_id=v_bu and je.operating_location_id=v_loc and je.reversal_of_entry_id=v_src.id and je.status='posted') then
    raise exception 'This payment voucher has already been reversed.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_bu::text||':'||v_loc::text||':payment_reversal_number',0));
  select coalesce(max(nullif(substring(entry_no from '^RV-([0-9]+)$'),'')::bigint),0)+1 into v_next
  from public.journal_entries
  where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_loc and entry_no~'^RV-[0-9]+$';
  v_rev_no:='RV-'||lpad(v_next::text,4,'0');

  insert into public.journal_entries(
    user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,
    reversal_of_entry_id,reversal_reason,source_module,source_document_type,source_document_id,created_by,updated_by
  ) values(
    v_uid,v_company,v_bu,v_loc,v_rev_no,p_reversal_date,
    'Reversal of '||v_src.entry_no||' - '||btrim(p_reason),'draft',v_src.payment_mode,v_src.party_name,
    case when v_src.trans_type='Customer Receipt' then 'Customer Receipt Reversal' else 'Supplier Payment Reversal' end,
    v_src.id,btrim(p_reason),'accounting','payment_reversal',v_src.id,v_actor,v_actor
  ) returning id into v_rev;

  insert into public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit,party_name,party_type,party_id,
    accounting_dimension_id,base_debit,base_credit
  )
  select v_uid,v_company,v_bu,v_loc,v_rev,jl.account,jl.account_id,jl.credit,jl.debit,jl.party_name,jl.party_type,jl.party_id,
         jl.accounting_dimension_id,jl.base_credit,jl.base_debit
  from public.journal_lines jl
  where jl.entry_id=v_src.id and jl.user_id=v_uid and jl.company_id=v_company and jl.business_unit_id=v_bu and jl.operating_location_id=v_loc;
  if not found then raise exception 'Original voucher has no journal lines to reverse.'; end if;

  select round(coalesce(sum(debit),0),2) into v_total from public.journal_lines where entry_id=v_rev;
  perform public.post_journal_entry(v_rev);

  if v_src.trans_type='Customer Receipt' then
    delete from public.invoice_payment_allocations
    where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_loc and journal_entry_id=v_src.id;
  else
    delete from public.purchase_payment_allocations
    where user_id=v_uid and company_id=v_company and business_unit_id=v_bu and operating_location_id=v_loc and journal_entry_id=v_src.id;
    -- The allocation DELETE trigger recalculates supplier invoice status, including posted debit notes/returns.
  end if;

  insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,performed_email,old_data,new_data,metadata)
  values(
    v_uid,'accounting','REVERSE_PAYMENT','journal_entries',v_rev,v_rev_no,v_actor::text,auth.jwt()->>'email',
    jsonb_build_object('original_entry_id',v_src.id,'original_entry_no',v_src.entry_no,'entry_date',v_src.entry_date,'trans_type',v_src.trans_type),
    jsonb_build_object('reversal_entry_id',v_rev,'reversal_entry_no',v_rev_no,'reversal_date',p_reversal_date,'reason',btrim(p_reason),'amount',v_total),
    jsonb_build_object('company_id',v_company,'business_unit_id',v_bu,'operating_location_id',v_loc)
  );

  return jsonb_build_object('success',true,'reversal_entry_id',v_rev,'reversal_entry_no',v_rev_no,'original_entry_no',v_src.entry_no,'amount',v_total);
end;
$function$
;
REVOKE ALL ON FUNCTION public.reverse_manual_journal_entry(uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_manual_journal_entry(uuid,date,text) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_payment_voucher(uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_payment_voucher(uuid,date,text) TO authenticated;
COMMIT;