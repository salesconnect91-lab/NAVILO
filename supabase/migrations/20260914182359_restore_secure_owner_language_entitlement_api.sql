create or replace function public.owner_get_company_language_entitlements(p_company_id uuid)
returns table(language_code text, enabled boolean, is_verified boolean)
language plpgsql stable security definer set search_path=public
as $$ begin
 if not public.is_platform_owner() then raise exception 'Platform owner access required'; end if;
 return query select e.language_code,e.enabled,e.is_verified from public.company_language_entitlements e where e.company_id=p_company_id order by e.language_code;
end $$;
create or replace function public.owner_set_company_language_entitlement(p_company_id uuid,p_language_code text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public
as $$ declare v_verified boolean; begin
 if not public.is_platform_owner() then raise exception 'Platform owner access required'; end if;
 select e.is_verified into v_verified from public.company_language_entitlements e where e.company_id=p_company_id and e.language_code=p_language_code;
 if coalesce(v_verified,false)=false and p_enabled then raise exception 'Translation pack is not verified'; end if;
 insert into public.company_language_entitlements(company_id,language_code,enabled,is_verified,updated_by,updated_at)
 values(p_company_id,p_language_code,p_enabled,coalesce(v_verified,false),auth.uid(),now())
 on conflict(company_id,language_code) do update set enabled=excluded.enabled,updated_by=auth.uid(),updated_at=now();
end $$;
revoke all on function public.owner_get_company_language_entitlements(uuid) from public;
revoke all on function public.owner_set_company_language_entitlement(uuid,text,boolean) from public;
grant execute on function public.owner_get_company_language_entitlements(uuid) to authenticated;
grant execute on function public.owner_set_company_language_entitlement(uuid,text,boolean) to authenticated;
