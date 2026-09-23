-- Historical production migration restricted enabled languages globally.
-- NAVILO is a global SaaS: keep entitlements company-specific and do not disable
-- catalog languages based on a single jurisdiction. Verification remains enforced
-- by owner_set_company_language_entitlement().
do $$ begin null; end $$;