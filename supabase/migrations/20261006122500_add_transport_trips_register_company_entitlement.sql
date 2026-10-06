-- Split the Trips/Register screen from the canonical Transport Workspace so it can be licensed per company.
insert into public.platform_features(feature_key,module_key,label,category,route_pattern,description,supported_actions,business_unit_types,default_enabled,core_locked,sort_order,is_active,source)
values ('transport-trips-register','transport','Trips / Register','transaction','/transport','Transport Trips register screen.',array['view','create','edit','post','delete','print','export'],array['transport'],true,false,601,true,'registry')
on conflict (feature_key) do update set module_key=excluded.module_key,label=excluded.label,category=excluded.category,route_pattern=excluded.route_pattern,description=excluded.description,supported_actions=excluded.supported_actions,business_unit_types=excluded.business_unit_types,default_enabled=excluded.default_enabled,core_locked=excluded.core_locked,sort_order=excluded.sort_order,is_active=true,source='registry',updated_at=now();

-- Gondal keeps the canonical Transport module, but does not expose the Trips/Register screen.
insert into public.company_feature_entitlements(company_id,feature_key,enabled,action_overrides,updated_at)
select id,'transport-trips-register',false,'{}'::jsonb,now() from public.companies where name='Gondal Transport'
on conflict (company_id,feature_key) do update set enabled=false,action_overrides='{}'::jsonb,updated_at=now();
