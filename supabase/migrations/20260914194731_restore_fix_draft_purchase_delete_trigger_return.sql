create or replace function public.prevent_posted_purchase_order_changes()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $function$
declare v_payment_update text;
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then if tg_op='DELETE' then return old; end if; return new; end if;
 if old.status='posted' then
  if tg_op='DELETE' then raise exception 'Posted purchase orders cannot be modified or deleted.'; end if;
  v_payment_update:=current_setting('app.supplier_payment_update',true);
  if coalesce(v_payment_update,'0')<>'1' then raise exception 'Posted purchase orders cannot be modified or deleted.'; end if;
  if (to_jsonb(new)-'paid_amount'-'outstanding_amount'-'payment_status') is distinct from (to_jsonb(old)-'paid_amount'-'outstanding_amount'-'payment_status') then raise exception 'Only payment status fields may change on a posted purchase order.'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $function$;