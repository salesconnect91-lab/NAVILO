-- Keep NAVILO global language catalog available. Entitlements are company-specific;
-- do not globally disable languages based on one jurisdiction.
-- Verified translation flags continue to control what a company can enable.
update public.company_language_entitlements
set enabled = enabled
where true;
