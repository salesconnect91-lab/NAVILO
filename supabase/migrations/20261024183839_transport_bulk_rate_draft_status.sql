-- Keep a draft Purchase document distinct from a posted supplier bill in the
-- Trip Register's supplier rate picker. Draft-linked rent remains locked until
-- the draft is deleted or posted, but it is never described as posted.
DO $migration$
DECLARE
 definition text:=pg_get_functiondef('public.transport_bulk_rate_page(text,integer,integer,jsonb)'::regprocedure);
 old_posted text:=$old$'posted',exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id),$old$;
 new_posted text:=$new$'posted',exists(
    select 1 from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    join public.transport_active_journals j on j.id=d.journal_entry_id
    where l.rent_id=r.id and not l.is_adjustment),
   'draftLinked',exists(
    select 1 from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    join public.purchase_orders po on po.id=d.purchase_order_id
    where l.rent_id=r.id and not l.is_adjustment and po.status='draft'
      and not exists(select 1 from public.transport_active_journals j where j.id=d.journal_entry_id)),$new$;
 old_billed text:=$old$'billed_supplier_net',case when exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id) then r.amount+a.difference end,$old$;
 new_billed text:=$new$'billed_supplier_net',case when exists(
    select 1 from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    join public.transport_active_journals j on j.id=d.journal_entry_id
    where l.rent_id=r.id and not l.is_adjustment) then r.amount+a.difference end,$new$;
 old_status text:=$old$case when exists(select 1 from public.transport_supplier_document_rents l where l.rent_id=r.id) then 'posted correction required'
    when r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null) then 'legacy correction required'$old$;
 new_status text:=$new$case when exists(
     select 1 from public.transport_supplier_document_rents l
     join public.transport_supplier_documents d on d.id=l.document_id
     join public.transport_active_journals j on j.id=d.journal_entry_id
     where l.rent_id=r.id and not l.is_adjustment) then 'posted correction required'
    when exists(
     select 1 from public.transport_supplier_document_rents l
     join public.transport_supplier_documents d on d.id=l.document_id
     join public.purchase_orders po on po.id=d.purchase_order_id
     where l.rent_id=r.id and not l.is_adjustment and po.status='draft'
       and not exists(select 1 from public.transport_active_journals j where j.id=d.journal_entry_id)) then 'draft invoice exists — delete draft to edit'
    when r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null) then 'legacy correction required'$new$;
BEGIN
 IF position(old_posted IN definition)=0 OR position(old_billed IN definition)=0 OR position(old_status IN definition)=0 THEN
  RAISE EXCEPTION 'Supplier draft status projection changed; inspect before applying';
 END IF;
 definition:=replace(definition,old_posted,new_posted);
 definition:=replace(definition,old_billed,new_billed);
 definition:=replace(definition,old_status,new_status);
 EXECUTE definition;
END
$migration$;
