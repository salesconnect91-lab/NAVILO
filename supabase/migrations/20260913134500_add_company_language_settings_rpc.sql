create or replace function public.save_company_language_settings(
  p_screen_mode text,
  p_screen_primary text,
  p_screen_secondary text,
  p_document_mode text,
  p_document_primary text,
  p_document_secondary text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_print_language text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_company is null then raise exception 'No active company selected'; end if;
  if not public.has_module_permission(v_company,'settings','edit') then raise exception 'Permission denied'; end if;

  if p_screen_mode not in ('single','bilingual') then raise exception 'Invalid screen language mode'; end if;
  if p_document_mode not in ('single','bilingual') then raise exception 'Invalid document language mode'; end if;
  if p_screen_primary not in ('en','ur','ar') then raise exception 'Unsupported screen language'; end if;
  if p_document_primary not in ('en','ur','ar') then raise exception 'Unsupported document language'; end if;

  if p_screen_mode='bilingual' then
    if p_screen_secondary not in ('en','ur','ar') or p_screen_secondary=p_screen_primary or not ((p_screen_primary='en' and p_screen_secondary in ('ur','ar')) or (p_screen_secondary='en' and p_screen_primary in ('ur','ar'))) then
      raise exception 'Bilingual screen mode supports English + Urdu or English + Arabic only';
    end if;
  end if;

  if p_document_mode='bilingual' then
    if p_document_secondary not in ('en','ur','ar') or p_document_secondary=p_document_primary or not ((p_document_primary='en' and p_document_secondary in ('ur','ar')) or (p_document_secondary='en' and p_document_primary in ('ur','ar'))) then
      raise exception 'Bilingual document mode supports English + Urdu or English + Arabic only';
    end if;
  end if;

  v_print_language := case
    when p_document_mode='bilingual' and ((p_document_primary='en' and p_document_secondary='ur') or (p_document_primary='ur' and p_document_secondary='en')) then 'both'
    when p_document_mode='single' and p_document_primary='ur' then 'urdu'
    else 'english'
  end;

  update public.company_settings
  set screen_language_mode=p_screen_mode,
      screen_primary_language=p_screen_primary,
      screen_secondary_language=case when p_screen_mode='bilingual' then p_screen_secondary else null end,
      document_language_mode=p_document_mode,
      document_primary_language=p_document_primary,
      document_secondary_language=case when p_document_mode='bilingual' then p_document_secondary else null end,
      print_language=v_print_language,
      updated_at=now()
  where company_id=v_company;

  if not found then raise exception 'Company settings not found'; end if;

  return jsonb_build_object(
    'company_id',v_company,
    'screen_mode',p_screen_mode,
    'screen_primary',p_screen_primary,
    'screen_secondary',case when p_screen_mode='bilingual' then p_screen_secondary else null end,
    'document_mode',p_document_mode,
    'document_primary',p_document_primary,
    'document_secondary',case when p_document_mode='bilingual' then p_document_secondary else null end
  );
end;
$$;

revoke all on function public.save_company_language_settings(text,text,text,text,text,text) from public, anon;
grant execute on function public.save_company_language_settings(text,text,text,text,text,text) to authenticated;
