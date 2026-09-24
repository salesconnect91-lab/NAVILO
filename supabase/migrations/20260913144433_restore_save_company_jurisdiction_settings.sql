create or replace function public.save_company_jurisdiction_settings(p_country_code text, p_currency text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_company uuid := public.current_company_id(); v_country text := upper(trim(coalesce(p_country_code,''))); v_currency text := upper(trim(coalesce(p_currency,'')));
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if v_company is null then raise exception 'No active company selected'; end if;
 if not public.has_module_permission(v_company,'settings','edit') then raise exception 'Permission denied'; end if;
 if v_country = '' then raise exception 'Country / jurisdiction is required'; end if;
 if v_currency = '' then raise exception 'Currency is required'; end if;
 update public.company_settings set country_code=v_country,currency=v_currency,updated_at=now() where company_id=v_company;
 if not found then raise exception 'Company settings not found'; end if;
 return jsonb_build_object('company_id',v_company,'country_code',v_country,'currency',v_currency);
end; $$;
revoke all on function public.save_company_jurisdiction_settings(text,text) from public, anon;
grant execute on function public.save_company_jurisdiction_settings(text,text) to authenticated;
