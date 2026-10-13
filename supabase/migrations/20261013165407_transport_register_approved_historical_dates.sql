begin;
do $patch$
declare f text; old_clause text:='if not v_is_controlled_opening'; new_clause text;
begin
 f:=pg_get_functiondef('public.enforce_journal_core_rules()'::regprocedure);
 new_clause:=$gate$if not v_is_controlled_opening
 and not exists (
 select 1 from public.transport_register_conversion_gates g
 join public.transport_register_invoice_conversions v on v.document_id=g.document_id
 join public.transport_opening_invoice_documents d on d.id=v.document_id
 where g.transaction_id=txid_current() and g.actor_id=auth.uid()
 and public.transport_register_conversion_allowed(g.order_id,g.side)
 and new.company_id=v.company_id
 and new.business_unit_id=v.business_unit_id
 and new.operating_location_id=v.operating_location_id
 and (
 (new.source_document_id=v.order_id and new.source_document_type in ('sales_invoice','purchase_invoice','sales_order','purchase_order') and new.entry_date=v.invoice_date)
 or (new.source_document_id=v.order_id and new.source_document_type='transport_historical_clearing' and new.entry_date=greatest(d.opening_date,v.invoice_date))
 or (new.source_document_id=v.document_id and new.source_document_type='transport_opening_invoice_reclassification' and new.entry_date=d.opening_date)
 )
 )$gate$;
 if strpos(f,old_clause)=0 then raise exception 'Expected journal backdate guard missing'; end if;
 execute replace(f,old_clause,new_clause);
end $patch$;
commit;
