-- Priority 1: posted-document immutability and maintenance bypass hardening.
-- Normal authenticated workflows must never gain a posted-document bypass merely
-- because a session-local maintenance flag is present. The maintenance bypass is
-- reserved for service_role maintenance routines.

create or replace function public.prevent_posted_sales_order_changes()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if old.status = 'posted' then
    if tg_op = 'DELETE' then
      raise exception 'Posted sales invoices cannot be deleted.';
    end if;

    if (to_jsonb(new)
          - 'paid_amount' - 'outstanding_amount' - 'payment_status'
          - 'updated_at' - 'updated_by')
       is distinct from
       (to_jsonb(old)
          - 'paid_amount' - 'outstanding_amount' - 'payment_status'
          - 'updated_at' - 'updated_by') then
      raise exception 'Posted sales invoices are immutable; only payment status fields may change.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

create or replace function public.prevent_posted_sales_order_line_changes()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_order_id uuid;
  v_status text;
begin
  if coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  select status into v_status from public.sales_orders where id = v_order_id;
  if v_status = 'posted' then
    raise exception 'Lines of a posted sales invoice cannot be modified.';
  end if;

  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    select status into v_status from public.sales_orders where id = old.order_id;
    if v_status = 'posted' then
      raise exception 'Lines of a posted sales invoice cannot be modified.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

create or replace function public.prevent_posted_purchase_order_changes()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_payment_update text;
begin
  if coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if old.status = 'posted' then
    if tg_op = 'DELETE' then
      raise exception 'Posted purchase orders cannot be modified or deleted.';
    end if;

    v_payment_update := current_setting('app.supplier_payment_update', true);
    if coalesce(v_payment_update, '0') <> '1' then
      raise exception 'Posted purchase orders cannot be modified or deleted.';
    end if;

    if (to_jsonb(new) - 'paid_amount' - 'outstanding_amount' - 'payment_status')
       is distinct from
       (to_jsonb(old) - 'paid_amount' - 'outstanding_amount' - 'payment_status') then
      raise exception 'Only payment status fields may change on a posted purchase order.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

create or replace function public.prevent_posted_purchase_order_line_changes()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_order_id uuid;
  v_status text;
begin
  if coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  select status into v_status from public.purchase_orders where id = v_order_id;
  if v_status = 'posted' then
    raise exception 'Lines of a posted purchase order cannot be modified.';
  end if;

  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    select status into v_status from public.purchase_orders where id = old.order_id;
    if v_status = 'posted' then
      raise exception 'Lines of a posted purchase order cannot be modified.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

create or replace function public.prevent_posted_return_note_changes()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if old.status = 'posted' then
    raise exception 'Posted Credit/Debit Notes are immutable. Create a correcting document instead.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

create or replace function public.prevent_posted_return_note_line_changes()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_note uuid;
  v_status text;
begin
  if coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_note := case when tg_op = 'DELETE' then old.note_id else new.note_id end;
  select status into v_status from public.return_notes where id = v_note;
  if v_status = 'posted' then
    raise exception 'Lines of a posted Credit/Debit Note are immutable.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

-- Permanently disable the obsolete posted-invoice reopen workflow. Corrections
-- must use Credit Note, Debit Note or approved reversal workflows.
create or replace function public.admin_reopen_posted_invoice(
  p_document_type text,
  p_document_id uuid,
  p_reason text,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  raise exception 'Posted Sales/Purchase documents are immutable. Use approved Credit Note, Debit Note or reversal workflows.';
end
$function$;

-- Trigger helpers are not direct application APIs.
revoke all on function public.prevent_posted_sales_order_changes() from public, anon, authenticated;
revoke all on function public.prevent_posted_sales_order_line_changes() from public, anon, authenticated;
revoke all on function public.prevent_posted_purchase_order_changes() from public, anon, authenticated;
revoke all on function public.prevent_posted_purchase_order_line_changes() from public, anon, authenticated;
revoke all on function public.prevent_posted_return_note_changes() from public, anon, authenticated;
revoke all on function public.prevent_posted_return_note_line_changes() from public, anon, authenticated;

grant execute on function public.prevent_posted_sales_order_changes() to service_role;
grant execute on function public.prevent_posted_sales_order_line_changes() to service_role;
grant execute on function public.prevent_posted_purchase_order_changes() to service_role;
grant execute on function public.prevent_posted_purchase_order_line_changes() to service_role;
grant execute on function public.prevent_posted_return_note_changes() to service_role;
grant execute on function public.prevent_posted_return_note_line_changes() to service_role;

revoke all on function public.admin_reopen_posted_invoice(text,uuid,text,date)
from public, anon, authenticated, service_role;
