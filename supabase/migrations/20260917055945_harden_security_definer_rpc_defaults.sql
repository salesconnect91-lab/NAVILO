alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

create or replace function public.create_and_post_return_note(
  p_note_type text,
  p_order_id uuid,
  p_note_date date,
  p_reason text,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null or public.current_company_id() is null or public.current_business_unit_id() is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;
  if p_note_type = 'sales_credit' then
    perform public.assert_module_permission('sales','post');
  elsif p_note_type = 'purchase_debit' then
    perform public.assert_module_permission('purchase','post');
  else
    raise exception 'Invalid return note type.';
  end if;
  perform public.assert_module_permission('inventory','post');
  perform public.assert_module_permission('accounting','post');

  perform set_config('app.return_note_atomic_post','1',true);
  if p_note_type='sales_credit' then
    perform set_config('app.customer_payment_update','1',true);
  else
    perform set_config('app.supplier_payment_update','1',true);
  end if;
  return public.create_and_post_return_note_internal(p_note_type,p_order_id,p_note_date,p_reason,p_lines);
end
$function$;

revoke all on function public.create_and_post_return_note(text,uuid,date,text,jsonb) from public, anon;
grant execute on function public.create_and_post_return_note(text,uuid,date,text,jsonb) to authenticated, service_role;

drop policy if exists preinvoice_document_counters_internal_only on public.preinvoice_document_counters;
create policy preinvoice_document_counters_internal_only
on public.preinvoice_document_counters
for all
to authenticated
using (false)
with check (false);
