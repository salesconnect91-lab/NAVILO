-- NAVILO Pakistan language policy:
-- English and Urdu are the only selectable/entitled languages for this release.
-- Keep historical rows for compatibility, but disable every other language.
update public.company_language_entitlements
set enabled = (language_code in ('en', 'ur')),
    is_verified = case
      when language_code in ('en', 'ur') then true
      else is_verified
    end;

