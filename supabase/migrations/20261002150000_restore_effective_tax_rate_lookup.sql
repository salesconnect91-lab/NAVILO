create or replace function public.fixed_tax_rate_on(p_company uuid,p_context text,p_date date)
returns numeric language sql stable security definer set search_path=public,pg_temp as $$
 select tr.rate from public.tax_rates tr
 where (session_user='postgres' or (p_company=public.current_company_id() and public.has_company_access(p_company)))
 and tr.company_id=p_company and tr.is_active and tr.is_fixed
 and tr.applies_to in (p_context,'both')
 and (tr.effective_from is null or tr.effective_from<=p_date)
 and (tr.effective_to is null or tr.effective_to>=p_date)
 order by tr.effective_from desc nulls last,tr.created_at desc,tr.id desc limit 1
$$;
revoke all on function public.fixed_tax_rate_on(uuid,text,date) from public,anon;
grant execute on function public.fixed_tax_rate_on(uuid,text,date) to authenticated;