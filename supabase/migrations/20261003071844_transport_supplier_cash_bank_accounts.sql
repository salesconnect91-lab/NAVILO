-- Support each real active Cash/Bank account, as customer receipts do. Keep the
-- canonical engine's permissions, scopes, FX, AP mapping and allocation logic.
do $$
declare definition text;old_guard text:=$old$if p_payment_account_id is distinct from v_cash and p_payment_account_id is distinct from v_bank then raise exception 'Payment account must be configured Cash or Bank.'; end if;$old$;
begin
 definition:=pg_get_functiondef('public.pay_supplier_transport_preserved_core(uuid,date,uuid,text,text,text,text,uuid,numeric)'::regprocedure);
 if position(old_guard in definition)=0 then raise exception 'Unexpected canonical Supplier payment account guard';end if;
 execute replace(definition,old_guard,$new$if not exists(select 1 from public.chart_of_accounts where id=p_payment_account_id and user_id=v_uid and company_id=v_company and is_active and not is_group and type='asset' and detail_type in ('Cash on Hand','Bank Account')) then raise exception 'Payment account must be an active same-company Cash or Bank account.'; end if;$new$);
end $$;
