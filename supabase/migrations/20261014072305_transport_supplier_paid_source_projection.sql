-- Read projection only. Retain immutable source snapshots and canonical postings.
begin;
do $patch$
declare f text; old_paid text; old_lines text;
begin
 f:=regexp_replace(pg_get_viewdef('public.transport_historical_payment_effective'::regclass,true),';\s*$','');
 old_paid:='COALESCE(h.paid_gross, 0::numeric)';
 old_lines:='sum(transport_opening_invoice_lines.opening_remaining) FILTER (WHERE transport_opening_invoice_lines.side = ''supplier''::text) AS supplier_remaining';
 if strpos(f,old_paid)=0 or strpos(f,old_lines)=0 then
  raise exception 'Supplier paid projection base changed; inspect before applying';
 end if;
 f:=replace(f,old_lines,old_lines||', sum(GREATEST(transport_opening_invoice_lines.original_gross - GREATEST(transport_opening_invoice_lines.opening_remaining,0::numeric),0::numeric)) FILTER (WHERE transport_opening_invoice_lines.side = ''supplier''::text) AS supplier_settled');
 f:=replace(f,old_paid,'CASE WHEN m.company_owned THEN 0::numeric WHEN l.supplier_document_id IS NOT NULL THEN COALESCE(l.supplier_settled,0::numeric) ELSE COALESCE(h.paid_gross,0::numeric) END');
 -- Existing outer partner exclusions, customer amounts, and posted payments remain intact.
 execute 'create or replace view public.transport_historical_payment_effective with(security_invoker=true) as '||f;
end $patch$;
notify pgrst,'reload schema';
commit;
