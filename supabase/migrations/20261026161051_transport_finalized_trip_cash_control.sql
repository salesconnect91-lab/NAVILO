BEGIN;

-- Pre-invoice settlement reservations tie an already-posted cash/bank advance
-- to a finalized Trip without creating a second journal or pretending an
-- invoice has been posted. The original payment remains in the party ledger.
CREATE TABLE IF NOT EXISTS public.transport_trip_advance_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  business_unit_id uuid NOT NULL REFERENCES public.business_units(id) ON DELETE RESTRICT,
  operating_location_id uuid NOT NULL REFERENCES public.operating_locations(id) ON DELETE RESTRICT,
  side text NOT NULL CHECK (side IN ('customer','supplier')),
  trip_id uuid NOT NULL REFERENCES public.transport_trips(id) ON DELETE RESTRICT,
  line_id uuid NOT NULL,
  party_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  journal_line_id uuid NOT NULL REFERENCES public.journal_lines(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  allocation_date date NOT NULL,
  reference text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_trip_advance_allocation_trip_idx
 ON public.transport_trip_advance_allocations(company_id,business_unit_id,operating_location_id,side,trip_id,line_id);
CREATE INDEX IF NOT EXISTS transport_trip_advance_allocation_source_idx
 ON public.transport_trip_advance_allocations(company_id,business_unit_id,operating_location_id,side,party_id,journal_entry_id);
ALTER TABLE public.transport_trip_advance_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transport_trip_advance_allocations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.transport_trip_advance_allocations TO authenticated;
DROP POLICY IF EXISTS transport_trip_advance_allocations_read ON public.transport_trip_advance_allocations;
CREATE POLICY transport_trip_advance_allocations_read ON public.transport_trip_advance_allocations
 FOR SELECT TO authenticated
 USING (company_id=public.current_company_id()
   AND business_unit_id=public.current_business_unit_id()
   AND operating_location_id=public.current_operating_location_id()
   AND public.transport_financial_read_allowed(side));

-- If a finalized Trip changes party before posting, return every pre-invoice
-- reservation to its original party advance and preserve the allocation audit.
CREATE OR REPLACE FUNCTION public.transport_release_prepost_reservations_on_party_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE a record; old_party uuid; new_party uuid; affected_trip uuid; trip_no_value text;
BEGIN
 IF TG_TABLE_NAME='transport_trips' THEN
  old_party:=OLD.customer_id;new_party:=NEW.customer_id;affected_trip:=NEW.id;trip_no_value:=NEW.trip_no;
  IF old_party IS NOT DISTINCT FROM new_party THEN RETURN NEW; END IF;
  FOR a IN DELETE FROM public.transport_trip_advance_allocations
    WHERE trip_id=NEW.id AND side='customer' RETURNING *
  LOOP
   INSERT INTO public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
   VALUES(a.company_id,a.business_unit_id,NEW.id,trip_no_value,'prepost_advance_party_changed',to_jsonb(a),
     jsonb_build_object('old_party_id',old_party,'new_party_id',new_party),
     'Reservation released because Trip customer changed before invoice posting',auth.uid());
  END LOOP;
 ELSE
  old_party:=OLD.supplier_id;new_party:=NEW.supplier_id;affected_trip:=NEW.trip_id;
  IF old_party IS NOT DISTINCT FROM new_party THEN RETURN NEW; END IF;
  SELECT trip_no INTO trip_no_value FROM public.transport_trips WHERE id=affected_trip;
  FOR a IN DELETE FROM public.transport_trip_advance_allocations
    WHERE line_id=NEW.id AND side='supplier' RETURNING *
  LOOP
   INSERT INTO public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
   VALUES(a.company_id,a.business_unit_id,affected_trip,trip_no_value,'prepost_advance_party_changed',to_jsonb(a),
     jsonb_build_object('old_party_id',old_party,'new_party_id',new_party),
     'Reservation released because Trip supplier changed before invoice posting',auth.uid());
  END LOOP;
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.transport_release_prepost_reservations_on_party_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS transport_trip_prepost_reservation_party_change ON public.transport_trips;
CREATE TRIGGER transport_trip_prepost_reservation_party_change AFTER UPDATE OF customer_id ON public.transport_trips
 FOR EACH ROW EXECUTE FUNCTION public.transport_release_prepost_reservations_on_party_change();
DROP TRIGGER IF EXISTS transport_supplier_rent_prepost_reservation_party_change ON public.transport_trip_supplier_rents;
CREATE TRIGGER transport_supplier_rent_prepost_reservation_party_change AFTER UPDATE OF supplier_id ON public.transport_trip_supplier_rents
 FOR EACH ROW EXECUTE FUNCTION public.transport_release_prepost_reservations_on_party_change();

-- Current operational amount, reserved advances and remaining pre-invoice
-- balance. Amounts here are the finalized trip/rent totals before invoice VAT;
-- VAT becomes official on the relevant invoice posting.
CREATE OR REPLACE VIEW public.transport_prepost_trip_balances
WITH (security_invoker=true) AS
WITH reserved AS (
 SELECT side,line_id,party_id,sum(amount)::numeric(18,2) allocated
 FROM public.transport_trip_advance_allocations
 WHERE company_id=public.current_company_id()
   AND business_unit_id=public.current_business_unit_id()
   AND operating_location_id=public.current_operating_location_id()
 GROUP BY side,line_id,party_id
), customer_rows AS (
 SELECT t.company_id,t.business_unit_id,t.operating_location_id,
        'customer'::text side,t.id line_id,t.id trip_id,t.trip_no,t.trip_date,
        t.customer_id party_id,c.name party_name,t.from_location,t.to_location,
        round(coalesce(t.customer_rate_snapshot,t.customer_rate,0),2) rate_amount,
        coalesce(r.allocated,0)::numeric(18,2) allocated
 FROM public.transport_trips t
 JOIN public.customers c ON c.id=t.customer_id AND c.company_id=t.company_id
 LEFT JOIN reserved r ON r.side='customer' AND r.line_id=t.id AND r.party_id=t.customer_id
 WHERE t.company_id=public.current_company_id()
   AND t.business_unit_id=public.current_business_unit_id()
   AND t.operating_location_id=public.current_operating_location_id()
   AND t.customer_rate_state='finalized'
   AND NOT public.transport_customer_side_posted(t.id)
   AND public.transport_financial_read_allowed('customer')
), supplier_rows AS (
 SELECT r.company_id,r.business_unit_id,coalesce(r.operating_location_id,t.operating_location_id) operating_location_id,
        'supplier'::text side,r.id line_id,r.trip_id,t.trip_no,t.trip_date,
        r.supplier_id party_id,coalesce(s.name,r.supplier_name_snapshot) party_name,
        t.from_location,t.to_location,
        round(coalesce(r.finalized_base_amount_snapshot,r.base_amount,r.amount,0),2) rate_amount,
        coalesce(a.allocated,0)::numeric(18,2) allocated
 FROM public.transport_trip_supplier_rents r
 JOIN public.transport_trips t ON t.id=r.trip_id
 LEFT JOIN public.suppliers s ON s.id=r.supplier_id AND s.company_id=r.company_id
 LEFT JOIN reserved a ON a.side='supplier' AND a.line_id=r.id AND a.party_id=r.supplier_id
 WHERE r.company_id=public.current_company_id()
   AND r.business_unit_id=public.current_business_unit_id()
   AND coalesce(r.operating_location_id,t.operating_location_id)=public.current_operating_location_id()
   AND r.state='finalized'
   AND NOT EXISTS (
     SELECT 1 FROM public.transport_supplier_document_rents l
     JOIN public.transport_supplier_documents d ON d.id=l.document_id
     JOIN public.purchase_orders o ON o.id=d.purchase_order_id
     WHERE l.rent_id=r.id AND NOT l.is_adjustment AND o.status='posted'
   )
   AND public.transport_financial_read_allowed('supplier')
)
SELECT *,round(rate_amount-allocated,2) remaining FROM customer_rows
UNION ALL
SELECT *,round(rate_amount-allocated,2) remaining FROM supplier_rows;
REVOKE ALL ON public.transport_prepost_trip_balances FROM PUBLIC,anon;
GRANT SELECT ON public.transport_prepost_trip_balances TO authenticated;

-- Keep available advance balances correct when a portion is reserved against a
-- finalized, not-yet-invoiced Trip.
CREATE OR REPLACE VIEW public.transport_party_advances
WITH (security_invoker=true) AS
WITH sources AS (
 SELECT j.id journal_entry_id,j.company_id,j.business_unit_id,j.operating_location_id,j.entry_no,j.entry_date,
        j.currency_code,j.description reference,j.trans_type,
        CASE WHEN l.party_type='customer' THEN 'customer' ELSE 'supplier' END side,
        l.party_id,
        CASE WHEN l.party_type='customer' THEN l.credit-l.debit ELSE l.debit-l.credit END amount
 FROM public.journal_entries j JOIN public.journal_lines l ON l.entry_id=j.id
 WHERE j.status='posted'
   AND ((j.trans_type='Customer Receipt' AND l.party_type='customer')
     OR (j.trans_type='Supplier Payment' AND l.party_type='supplier'))
   AND NOT EXISTS(SELECT 1 FROM public.journal_entries x WHERE x.reversal_of_entry_id=j.id AND x.status='posted')
   AND j.company_id=public.current_company_id()
   AND j.business_unit_id=public.current_business_unit_id()
   AND j.operating_location_id=public.current_operating_location_id()
   AND public.has_module_permission(j.company_id,'transport','view')
   AND public.has_module_permission(j.company_id,'accounting','view')
), available AS (
 SELECT s.*,
   coalesce((CASE WHEN s.side='customer'
     THEN (SELECT sum(a.amount) FROM public.invoice_payment_allocations a WHERE a.journal_entry_id=s.journal_entry_id)
     ELSE (SELECT sum(a.amount) FROM public.purchase_payment_allocations a WHERE a.journal_entry_id=s.journal_entry_id)
   END),0)
   +coalesce((SELECT sum(x.amount) FROM public.transport_trip_advance_allocations x
       WHERE x.journal_entry_id=s.journal_entry_id AND x.side=s.side AND x.party_id=s.party_id),0) allocated
 FROM sources s JOIN public.companies c ON c.id=s.company_id
 WHERE coalesce(s.currency_code,c.base_currency_code)=c.base_currency_code
)
SELECT *,greatest(amount-allocated,0) available FROM available WHERE amount-allocated>0.005;
REVOKE ALL ON public.transport_party_advances FROM PUBLIC,anon;
GRANT SELECT ON public.transport_party_advances TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_allocate_prepost_trip_advance(
 p_request_id uuid,p_side text,p_operation text,p_party_id uuid,p_trip_id uuid,
 p_line_id uuid,p_source_id uuid,p_allocation_id uuid,p_amount numeric,p_reference text,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
 c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
 body jsonb; stored public.transport_settlement_requests%rowtype; target record; source record; allocation record;
 available_advance numeric; due numeric; outcome jsonb; payment_line uuid;
BEGIN
 PERFORM public.transport_finance_assert('settlement');
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL
    OR p_request_id IS NULL OR p_side NOT IN ('customer','supplier')
    OR p_operation NOT IN ('allocate','release')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'Active branch, valid action and a reason are required';
 END IF;
 IF p_operation='allocate' AND (p_amount IS NULL OR p_amount<=0 OR round(p_amount,2)<>p_amount
    OR p_party_id IS NULL OR p_trip_id IS NULL OR p_line_id IS NULL OR p_source_id IS NULL) THEN
   RAISE EXCEPTION 'Party, Trip, finalized line, advance voucher and positive amount are required';
 END IF;
 IF p_operation='release' AND p_allocation_id IS NULL THEN
   RAISE EXCEPTION 'Trip advance allocation is required';
 END IF;
 body:=jsonb_build_object('action','prepost_trip_advance_'||p_operation,'side',p_side,
   'party',p_party_id,'trip',p_trip_id,'line',p_line_id,'source',p_source_id,
   'allocation',p_allocation_id,'amount',p_amount,'reference',p_reference,'reason',p_reason);
 INSERT INTO public.transport_settlement_requests(company_id,business_unit_id,operating_location_id,request_id,created_by,payload)
 VALUES(c,b,loc,p_request_id,auth.uid(),body) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT stored FROM public.transport_settlement_requests
  WHERE company_id=c AND business_unit_id=b AND operating_location_id=loc AND request_id=p_request_id FOR UPDATE;
 IF stored.created_by<>auth.uid() OR stored.payload<>body THEN
   RAISE EXCEPTION 'Request ID already used for a different actor or payload';
 END IF;
 IF stored.result IS NOT NULL THEN RETURN stored.result; END IF;

 IF p_operation='release' THEN
   SELECT * INTO allocation FROM public.transport_trip_advance_allocations
    WHERE id=p_allocation_id AND company_id=c AND business_unit_id=b AND operating_location_id=loc
      AND public.transport_financial_read_allowed(side) FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Pre-invoice Trip allocation not found in active branch'; END IF;
   DELETE FROM public.transport_trip_advance_allocations WHERE id=allocation.id;
   INSERT INTO public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
   SELECT c,b,allocation.trip_id,t.trip_no,'prepost_advance_released',to_jsonb(allocation),'{}'::jsonb,btrim(p_reason),auth.uid()
   FROM public.transport_trips t WHERE t.id=allocation.trip_id;
   outcome:=jsonb_build_object('success',true,'released',allocation.amount,'party_id',allocation.party_id,'side',allocation.side);
 ELSE
   IF p_side='customer' THEN
     PERFORM 1 FROM public.transport_trips t WHERE t.id=p_trip_id AND t.company_id=c
       AND t.business_unit_id=b AND t.operating_location_id=loc FOR UPDATE;
   ELSE
     PERFORM 1 FROM public.transport_trip_supplier_rents r WHERE r.id=p_line_id AND r.trip_id=p_trip_id
       AND r.company_id=c AND r.business_unit_id=b AND coalesce(r.operating_location_id,loc)=loc FOR UPDATE;
   END IF;
   IF NOT FOUND THEN RAISE EXCEPTION 'Finalized Trip line is not available in active branch'; END IF;
   PERFORM 1 FROM public.journal_entries j WHERE j.id=p_source_id AND j.company_id=c
      AND j.business_unit_id=b AND j.operating_location_id=loc AND j.status='posted' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Advance voucher is not posted in active branch'; END IF;
   SELECT * INTO target FROM public.transport_prepost_trip_balances x
    WHERE x.side=p_side AND x.line_id=p_line_id AND x.trip_id=p_trip_id AND x.party_id=p_party_id
      AND x.company_id=c AND x.business_unit_id=b AND x.operating_location_id=loc;
   IF NOT FOUND THEN RAISE EXCEPTION 'Finalized unposted Trip side for this party is not available'; END IF;
   IF target.remaining<=0.005 OR p_amount>target.remaining+0.005 THEN
     RAISE EXCEPTION 'Allocation exceeds this finalized Trip side balance. Remaining: %',target.remaining;
   END IF;
   SELECT * INTO source FROM public.transport_party_advances a
    WHERE a.journal_entry_id=p_source_id AND a.side=p_side AND a.party_id=p_party_id AND a.available>0.005;
   IF NOT FOUND OR p_amount>source.available+0.005 THEN
     RAISE EXCEPTION 'Available, unreversed advance for the same party is required';
   END IF;
   SELECT l.id INTO payment_line FROM public.journal_lines l
    WHERE l.entry_id=p_source_id AND l.party_id=p_party_id
      AND l.party_type=CASE WHEN p_side='customer' THEN 'customer' ELSE 'supplier' END
    ORDER BY l.id LIMIT 1;
   IF payment_line IS NULL THEN RAISE EXCEPTION 'Payment voucher has no matching party ledger line'; END IF;
   INSERT INTO public.transport_trip_advance_allocations(
    company_id,business_unit_id,operating_location_id,side,trip_id,line_id,party_id,journal_entry_id,journal_line_id,
    amount,allocation_date,reference,created_by)
   VALUES(c,b,loc,p_side,p_trip_id,p_line_id,p_party_id,p_source_id,payment_line,p_amount,current_date,
    nullif(btrim(p_reference),''),auth.uid());
   INSERT INTO public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
   SELECT c,b,p_trip_id,t.trip_no,'prepost_advance_allocated','{}'::jsonb,
     jsonb_build_object('side',p_side,'party_id',p_party_id,'source_journal_id',p_source_id,'amount',p_amount,'reference',p_reference),
     btrim(p_reason),auth.uid() FROM public.transport_trips t WHERE t.id=p_trip_id;
   outcome:=jsonb_build_object('success',true,'allocated',p_amount,'remaining_trip_balance',round(target.remaining-p_amount,2),'side',p_side);
 END IF;
 UPDATE public.transport_settlement_requests SET result=outcome
  WHERE company_id=c AND business_unit_id=b AND operating_location_id=loc AND request_id=p_request_id;
 RETURN outcome;
END;
$function$;
REVOKE ALL ON FUNCTION public.transport_allocate_prepost_trip_advance(uuid,text,text,uuid,uuid,uuid,uuid,uuid,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_allocate_prepost_trip_advance(uuid,text,text,uuid,uuid,uuid,uuid,uuid,numeric,text,text) TO authenticated;

-- Posting a draft converts reservations into the existing invoice allocation
-- rows inside the same transaction. Cash/Bank is not posted a second time.
CREATE OR REPLACE FUNCTION public.transport_apply_prepost_trip_advances(p_side text,p_order_id uuid,p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE r record; d record; amount_to_apply numeric; already_paid numeric;
BEGIN
 IF p_side='customer' THEN
  SELECT o.id,o.total,o.customer_id,o.order_date INTO d FROM public.sales_orders o
   WHERE o.id=p_order_id AND o.status='posted' AND o.company_id=public.current_company_id()
    AND o.business_unit_id=public.current_business_unit_id() AND o.operating_location_id=public.current_operating_location_id() FOR UPDATE;
 ELSE
  SELECT o.id,o.total,o.supplier_id,o.order_date INTO d FROM public.purchase_orders o
   WHERE o.id=p_order_id AND o.status='posted' AND o.company_id=public.current_company_id()
    AND o.business_unit_id=public.current_business_unit_id() AND o.operating_location_id=public.current_operating_location_id() FOR UPDATE;
 END IF;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Posted invoice is required before Trip advance allocation'; END IF;
 FOR r IN
  SELECT a.journal_entry_id,sum(a.amount)::numeric(18,2) reserved,
    (SELECT coalesce(x.amount,0)-coalesce(x.allocated,0)
       FROM public.transport_party_advances x WHERE x.journal_entry_id=a.journal_entry_id AND x.side=p_side AND x.party_id=a.party_id) available,
    a.party_id
  FROM public.transport_trip_advance_allocations a
  WHERE a.company_id=public.current_company_id() AND a.business_unit_id=public.current_business_unit_id()
    AND a.operating_location_id=public.current_operating_location_id() AND a.side=p_side AND a.party_id=CASE WHEN p_side='customer' THEN d.customer_id ELSE d.supplier_id END
    AND ((p_side='customer' AND EXISTS(SELECT 1 FROM public.transport_customer_document_trips l WHERE l.document_id=p_document_id AND l.trip_id=a.trip_id AND NOT l.is_adjustment))
      OR (p_side='supplier' AND EXISTS(SELECT 1 FROM public.transport_supplier_document_rents l WHERE l.document_id=p_document_id AND l.rent_id=a.line_id AND NOT l.is_adjustment)))
  GROUP BY a.journal_entry_id,a.party_id
 LOOP
  -- Releasing this source's reservations first makes the original advance
  -- available to the existing allocation RPC. A failure rolls back the release.
  DELETE FROM public.transport_trip_advance_allocations a
   WHERE a.journal_entry_id=r.journal_entry_id AND a.side=p_side
    AND a.company_id=public.current_company_id() AND a.business_unit_id=public.current_business_unit_id()
    AND a.operating_location_id=public.current_operating_location_id()
    AND ((p_side='customer' AND EXISTS(SELECT 1 FROM public.transport_customer_document_trips l WHERE l.document_id=p_document_id AND l.trip_id=a.trip_id AND NOT l.is_adjustment))
      OR (p_side='supplier' AND EXISTS(SELECT 1 FROM public.transport_supplier_document_rents l WHERE l.document_id=p_document_id AND l.rent_id=a.line_id AND NOT l.is_adjustment)));
  IF p_side='customer' THEN
   SELECT coalesce(sum(a.amount),0) INTO already_paid FROM public.invoice_payment_allocations a WHERE a.sales_order_id=p_order_id;
  ELSE
   SELECT coalesce(sum(a.amount),0) INTO already_paid FROM public.purchase_payment_allocations a WHERE a.purchase_order_id=p_order_id;
  END IF;
  amount_to_apply:=least(r.reserved,greatest(coalesce(d.total,0)-coalesce(already_paid,0),0),greatest(coalesce(r.available,0)+r.reserved,0));
  IF amount_to_apply>0.005 THEN
   IF p_side='customer' THEN
    PERFORM public.allocate_customer_advance(r.journal_entry_id,p_order_id,amount_to_apply,greatest(coalesce(d.order_date,current_date),current_date),'Trip advance auto-allocation','Applied from finalized Trip reservation when invoice posted');
   ELSE
    PERFORM public.allocate_supplier_advance(r.journal_entry_id,p_order_id,amount_to_apply,greatest(coalesce(d.order_date,current_date),current_date),'Trip advance auto-allocation','Applied from finalized Trip reservation when invoice posted');
   END IF;
  END IF;
 END LOOP;
 IF p_side='customer' THEN
  DELETE FROM public.transport_trip_advance_allocations a
   WHERE a.side='customer' AND a.company_id=public.current_company_id() AND a.business_unit_id=public.current_business_unit_id()
    AND a.operating_location_id=public.current_operating_location_id()
    AND EXISTS(SELECT 1 FROM public.transport_customer_document_trips l WHERE l.document_id=p_document_id AND l.trip_id=a.trip_id AND NOT l.is_adjustment);
 ELSE
  DELETE FROM public.transport_trip_advance_allocations a
   WHERE a.side='supplier' AND a.company_id=public.current_company_id() AND a.business_unit_id=public.current_business_unit_id()
    AND a.operating_location_id=public.current_operating_location_id()
    AND EXISTS(SELECT 1 FROM public.transport_supplier_document_rents l WHERE l.document_id=p_document_id AND l.rent_id=a.line_id AND NOT l.is_adjustment);
 END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.transport_apply_prepost_trip_advances(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transport_apply_prepost_trip_advances(text,uuid,uuid) TO authenticated;

DO $patch$
DECLARE f text;
BEGIN
 f:=pg_get_functiondef('public.transport_post_customer_draft(uuid)'::regprocedure);
 IF position('transport_apply_prepost_trip_advances' in f)=0 THEN
  IF position('PERFORM public.transport_refresh_document_balance(''customer'',o.id);' in f)=0 THEN
    RAISE EXCEPTION 'Customer draft-post function changed; refusing unsafe reservation patch';
  END IF;
  f:=replace(f,'  PERFORM public.transport_refresh_document_balance(''customer'',o.id);',
    '  PERFORM public.transport_refresh_document_balance(''customer'',o.id);'||E'\n  PERFORM public.transport_apply_prepost_trip_advances(''customer'',o.id,d.id);'||E'\n  PERFORM public.transport_refresh_document_balance(''customer'',o.id);');
  EXECUTE f;
 END IF;
 f:=pg_get_functiondef('public.transport_post_supplier_draft(uuid)'::regprocedure);
 IF position('transport_apply_prepost_trip_advances' in f)=0 THEN
  IF position('PERFORM public.transport_refresh_document_balance(''supplier'',o.id);' in f)=0 THEN
    RAISE EXCEPTION 'Supplier draft-post function changed; refusing unsafe reservation patch';
  END IF;
  f:=replace(f,'  PERFORM public.transport_refresh_document_balance(''supplier'',o.id);',
    '  PERFORM public.transport_refresh_document_balance(''supplier'',o.id);'||E'\n  PERFORM public.transport_apply_prepost_trip_advances(''supplier'',o.id,d.id);'||E'\n  PERFORM public.transport_refresh_document_balance(''supplier'',o.id);');
  EXECUTE f;
 END IF;
END;
$patch$;

NOTIFY pgrst,'reload schema';
COMMIT;
