-- Keep the 20,000-Trip and 25-row atomic limits; permit five-row client batches
-- so payment-heavy imports have headroom under authenticated request timeouts.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.transport_prepare_history_import(text,text,jsonb,jsonb)'::regprocedure);
 if position('jsonb_array_length(p_manifest) not between 1 and 800' in definition)=0 then raise exception 'Unexpected historical manifest definition';end if;
 execute replace(definition,'jsonb_array_length(p_manifest) not between 1 and 800','jsonb_array_length(p_manifest) not between 1 and 4000');
end $$;
