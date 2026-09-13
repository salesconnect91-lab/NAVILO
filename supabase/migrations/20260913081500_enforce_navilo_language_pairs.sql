update public.company_settings
set screen_language_mode='single', screen_secondary_language=null
where coalesce(screen_language_mode,'single')='bilingual'
  and not (
    screen_primary_language is not null and screen_secondary_language is not null
    and screen_primary_language<>screen_secondary_language
    and (screen_primary_language='en' or screen_secondary_language='en')
    and (screen_primary_language in ('ur','ar') or screen_secondary_language in ('ur','ar'))
  );

update public.company_settings
set document_language_mode='single', document_secondary_language=null
where coalesce(document_language_mode,'single')='bilingual'
  and not (
    document_primary_language is not null and document_secondary_language is not null
    and document_primary_language<>document_secondary_language
    and (document_primary_language='en' or document_secondary_language='en')
    and (document_primary_language in ('ur','ar') or document_secondary_language in ('ur','ar'))
  );

update public.company_settings set screen_secondary_language=null where coalesce(screen_language_mode,'single')='single' and screen_secondary_language is not null;
update public.company_settings set document_secondary_language=null where coalesce(document_language_mode,'single')='single' and document_secondary_language is not null;

update public.user_language_preferences
set screen_language_mode='single', secondary_language=null
where coalesce(screen_language_mode,'single')='bilingual'
  and not (
    primary_language is not null and secondary_language is not null
    and primary_language<>secondary_language
    and (primary_language='en' or secondary_language='en')
    and (primary_language in ('ur','ar') or secondary_language in ('ur','ar'))
  );
update public.user_language_preferences set secondary_language=null where coalesce(screen_language_mode,'single')='single' and secondary_language is not null;

alter table public.company_settings drop constraint if exists company_settings_screen_language_pair;
alter table public.company_settings add constraint company_settings_screen_language_pair check (
  coalesce(screen_language_mode,'single') in ('single','bilingual')
  and (
    coalesce(screen_language_mode,'single')='single'
    or (
      screen_secondary_language is not null
      and screen_primary_language<>screen_secondary_language
      and (screen_primary_language='en' or screen_secondary_language='en')
      and (screen_primary_language in ('ur','ar') or screen_secondary_language in ('ur','ar'))
    )
  )
);

alter table public.company_settings drop constraint if exists company_settings_document_language_pair;
alter table public.company_settings add constraint company_settings_document_language_pair check (
  coalesce(document_language_mode,'single') in ('single','bilingual')
  and (
    coalesce(document_language_mode,'single')='single'
    or (
      document_secondary_language is not null
      and document_primary_language<>document_secondary_language
      and (document_primary_language='en' or document_secondary_language='en')
      and (document_primary_language in ('ur','ar') or document_secondary_language in ('ur','ar'))
    )
  )
);

alter table public.user_language_preferences drop constraint if exists user_language_preferences_pair;
alter table public.user_language_preferences add constraint user_language_preferences_pair check (
  coalesce(screen_language_mode,'single')='single'
  or (
    secondary_language is not null
    and primary_language<>secondary_language
    and (primary_language='en' or secondary_language='en')
    and (primary_language in ('ur','ar') or secondary_language in ('ur','ar'))
  )
);
