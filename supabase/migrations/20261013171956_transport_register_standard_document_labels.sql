begin;
do $patch$ declare f text;begin
 f:=pg_get_functiondef('public.transport_convert_register_invoice_batch(text,integer,boolean)'::regprocedure);
 f:=replace(f,'''Historical Register','''Register');
 f:=replace(f,'''Historical Trip ','''Trip ');
 f:=replace(f,'''Historical supplier rent', '''Supplier rent');
 f:=replace(f,'''Historical settled balance transfer', '''Settled balance transfer');
 f:=replace(f,'''Historical opening conversion', '''Opening balance transfer');
 f:=replace(f,'Controlled historical reconstruction','Controlled source reconstruction');
 execute f;
end $patch$;
commit;
