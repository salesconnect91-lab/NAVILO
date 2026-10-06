-- Synced from verified production migration 20261006211904 (register_transport_mobile_quick_entry).
insert into public.platform_features(
  feature_key,module_key,label,category,route_pattern,description,
  supported_actions,business_unit_types,default_enabled,core_locked,
  sort_order,is_active,source
) values (
  'transport-mobile-quick-entry',
  'transport',
  'Mobile Quick Entry',
  'transaction',
  '/transport/mobile',
  'Mobile-first recent Trip search, new Trip entry and allowed Trip editing.',
  array['view','create','edit'],
  array['transport'],
  true,
  false,
  609,
  true,
  'registry'
)
on conflict(feature_key) do update set
  module_key=excluded.module_key,
  label=excluded.label,
  category=excluded.category,
  route_pattern=excluded.route_pattern,
  description=excluded.description,
  supported_actions=excluded.supported_actions,
  business_unit_types=excluded.business_unit_types,
  default_enabled=excluded.default_enabled,
  core_locked=excluded.core_locked,
  sort_order=excluded.sort_order,
  is_active=true,
  source='registry',
  updated_at=now();
