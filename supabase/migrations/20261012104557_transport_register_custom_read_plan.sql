-- A cached generic Register plan exceeded production's 8-second read budget.
-- The identical signed-in Owner query with a custom plan completed in 5.5s.
-- Scope the planner setting to this existing read RPC; preserve its body,
-- tenant/branch/financial guards, grants and caller session settings.
alter function public.transport_register_query(integer,integer,jsonb,text,text,text,text)
 set plan_cache_mode = force_custom_plan;
