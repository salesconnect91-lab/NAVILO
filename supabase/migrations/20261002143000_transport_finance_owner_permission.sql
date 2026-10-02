-- Ensure active Transport workspace owners/admins receive the documented finance default.
create or replace function public.transport_finance_allowed(p_action text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();v boolean;r text;
begin
 if auth.uid() is null or c is null or b is null then return false; end if;
 if p_action not in ('billing','rent','settlement','driver','cost','adjustment','close') then return false; end if;
 if not public.company_module_enabled(c,'transport') then return false; end if;
 select allowed into v from public.transport_financial_permissions where company_id=c and business_unit_id=b and user_id=auth.uid() and action=p_action;
 if found then return v; end if;
 select role into r from public.business_unit_memberships where company_id=c and business_unit_id=b and user_id=auth.uid() and is_active limit 1;
 if r in ('company_owner','admin') then return true; end if;
 return public.has_module_permission(c,'transport','post');
end $$;
revoke all on function public.transport_finance_allowed(text) from public,anon;
grant execute on function public.transport_finance_allowed(text) to authenticated;