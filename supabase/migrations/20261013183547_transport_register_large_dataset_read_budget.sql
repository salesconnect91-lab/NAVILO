begin; alter function public.transport_register_query(integer,integer,jsonb,text,text,text,text) set statement_timeout='60s'; notify pgrst,'reload schema'; commit;;
