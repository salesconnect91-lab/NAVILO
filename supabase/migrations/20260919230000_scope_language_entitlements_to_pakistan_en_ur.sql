-- NAVILO verified language policy:
-- English, Urdu and Arabic have verified translations and may be selected.
-- Other runtime locales remain unavailable until their complete translations
-- are verified. Existing historical rows are retained for compatibility.
update public.company_language_entitlements
set enabled = (language_code in ('en', 'ur', 'ar'));

