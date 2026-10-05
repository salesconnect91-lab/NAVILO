-- Dashboard is optional per company. Keep default enabled, but allow Platform Owner
-- to disable it through the existing feature entitlement engine.
-- Existing company entitlements and all other feature rules remain unchanged.
update public.platform_features
set core_locked = false,
    default_enabled = true,
    updated_at = now()
where feature_key = 'dashboard';
