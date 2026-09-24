do $$
begin
 if to_regprocedure('public.admin_invoice_correction_preflight(text,uuid,text)') is not null then execute 'revoke execute on function public.admin_invoice_correction_preflight(text,uuid,text) from public, anon, authenticated, service_role'; end if;
 if to_regprocedure('public.create_admin_invoice_reversal_journal(text,uuid,text,date)') is not null then execute 'revoke execute on function public.create_admin_invoice_reversal_journal(text,uuid,text,date) from public, anon, authenticated, service_role'; end if;
 if to_regprocedure('public.reverse_admin_invoice_stock(text,uuid,text)') is not null then execute 'revoke execute on function public.reverse_admin_invoice_stock(text,uuid,text) from public, anon, authenticated, service_role'; end if;
 if to_regprocedure('public.log_admin_posted_action(uuid,text,text,uuid,text,text,text,jsonb,jsonb)') is not null then execute 'revoke execute on function public.log_admin_posted_action(uuid,text,text,uuid,text,text,text,jsonb,jsonb) from public, anon, authenticated, service_role'; end if;
end $$;