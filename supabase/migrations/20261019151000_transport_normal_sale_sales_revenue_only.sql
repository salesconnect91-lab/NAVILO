-- Forward-only guard: non-trip Normal Sale income always posts to company Sales Revenue.
-- Trip Service posting and existing posted evidence are not changed.
do $guard$
declare
 f text;
 anchor text:='mode:=public.transport_party_billing_mode(p_side,c,b,p_party);';
 rule text:=$rule$
 IF p_side='customer' AND p_account IS DISTINCT FROM
     public.fx_mapping_account(u,c,'sales_revenue','revenue') THEN
   RAISE EXCEPTION 'Normal Sale must use company Sales Revenue; Trip Service Revenue is not allowed';
 END IF;
$rule$;
begin
 f:=pg_get_functiondef('public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean)'::regprocedure);
 if strpos(f,'Normal Sale must use company Sales Revenue')=0 then
   if strpos(f,anchor)=0 then raise exception 'Normal Sale billing rule changed: migration halted';end if;
   execute replace(f,anchor,rule||chr(10)||' '||anchor);
 end if;
end $guard$;
