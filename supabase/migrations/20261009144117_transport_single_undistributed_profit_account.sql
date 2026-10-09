-- One ongoing profit equity account; historical opening remains linked to its original GL.
begin;
do $$declare original text;patched text;begin
 original:=pg_get_functiondef('public.transport_close_profit_month(date,uuid,text)'::regprocedure);
 patched:=replace(original,'and lower(a.name) not like ''%august%''','and lower(btrim(a.name))=''undistributed profit''');
 if patched=original then raise exception 'Single profit account patch did not match';end if;
 patched:=replace(patched,'Select an active posting equity account for ongoing Undistributed Profit','Select the active Undistributed Profit equity account');
 patched:=replace(patched,'net:=(preview->>''net_profit'')::numeric;',
 'if (select count(*) from public.chart_of_accounts a where a.company_id=c and a.is_active and not a.is_group and a.allow_manual_entries and a.type=''equity'' and lower(btrim(a.name))=''undistributed profit'')<>1 then raise exception ''Exactly one active Undistributed Profit account required'';end if;
 net:=(preview->>''net_profit'')::numeric;');
 execute patched;
end $$;
notify pgrst,'reload schema';
commit;
