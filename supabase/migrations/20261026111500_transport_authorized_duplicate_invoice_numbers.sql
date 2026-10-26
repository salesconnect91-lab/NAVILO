-- Authorized duplicate transport invoice numbers.
-- Conflict lookup is limited to companies where the caller has an active membership.
-- Duplicate saves require an owner/admin role or an explicit transport_actions
-- duplicate_invoice_override permission, a UI acknowledgement, and an audit row.

CREATE OR REPLACE FUNCTION public.transport_invoice_duplicate_override_allowed(p_side text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); r text; v jsonb;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR p_side NOT IN ('customer','supplier') THEN RETURN false; END IF;
 IF public.is_platform_owner() THEN RETURN true; END IF;
 IF NOT public.has_module_permission(c,CASE WHEN p_side='customer' THEN 'sales' ELSE 'purchase' END,'create') THEN RETURN false; END IF;
 SELECT role,permissions INTO r,v FROM public.business_unit_memberships
  WHERE company_id=c AND business_unit_id=b AND user_id=auth.uid() AND is_active LIMIT 1;
 IF r IN ('company_owner','admin') OR coalesce((v#>>'{transport_actions,duplicate_invoice_override}')::boolean,false) THEN RETURN true; END IF;
 SELECT role,permissions INTO r,v FROM public.company_memberships
  WHERE company_id=c AND user_id=auth.uid() AND is_active LIMIT 1;
 RETURN r IN ('company_owner','admin') OR coalesce((v#>>'{transport_actions,duplicate_invoice_override}')::boolean,false);
END $function$;
REVOKE ALL ON FUNCTION public.transport_invoice_duplicate_override_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_invoice_duplicate_override_allowed(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_invoice_number_conflicts(p_side text,p_number text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE c uuid:=public.current_company_id(); out_json jsonb;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR p_side NOT IN ('customer','supplier') OR nullif(btrim(p_number),'') IS NULL OR length(btrim(p_number))>80
 THEN RAISE EXCEPTION 'Valid invoice side, number and authenticated workspace required'; END IF;
 IF NOT public.has_module_permission(c,CASE WHEN p_side='customer' THEN 'sales' ELSE 'purchase' END,'create')
 THEN RAISE EXCEPTION 'Invoice creation permission required'; END IF;
 WITH accessible AS (
  SELECT c company_id
  UNION SELECT company_id FROM public.company_memberships WHERE user_id=auth.uid() AND is_active
  UNION SELECT company_id FROM public.business_unit_memberships WHERE user_id=auth.uid() AND is_active
 ), matches AS (
  SELECT 'customer' side,so.company_id,so.id document_id,so.order_no number,so.order_date document_date,so.status
   FROM public.sales_orders so JOIN accessible a USING(company_id)
   WHERE p_side='customer' AND lower(btrim(so.order_no))=lower(btrim(p_number))
  UNION
  SELECT 'supplier',po.company_id,po.id,po.order_no,po.order_date,po.status
   FROM public.purchase_orders po JOIN accessible a USING(company_id)
   WHERE p_side='supplier' AND (lower(btrim(po.order_no))=lower(btrim(p_number)) OR lower(btrim(po.supplier_invoice_no))=lower(btrim(p_number)))
 ), rows AS (
  SELECT m.side,m.company_id,m.document_id,m.number,m.document_date,m.status,co.name company,
    coalesce(array_agg(DISTINCT trip.trip_no) FILTER(WHERE trip.trip_no IS NOT NULL),'{}'::text[]) || coalesce(array_agg(DISTINCT strip.trip_no) FILTER(WHERE strip.trip_no IS NOT NULL),'{}'::text[]) trips
  FROM matches m JOIN public.companies co ON co.id=m.company_id
  LEFT JOIN public.transport_customer_documents cd ON m.side='customer' AND cd.sales_order_id=m.document_id
  LEFT JOIN public.transport_customer_document_trips ctl ON m.side='customer' AND ctl.document_id=cd.id AND NOT ctl.is_adjustment
  LEFT JOIN public.transport_trips trip ON trip.id=ctl.trip_id AND trip.company_id=m.company_id
  LEFT JOIN public.transport_supplier_documents sd ON m.side='supplier' AND sd.purchase_order_id=m.document_id
  LEFT JOIN public.transport_supplier_document_rents stl ON m.side='supplier' AND stl.document_id=sd.id AND NOT stl.is_adjustment
  LEFT JOIN public.transport_trips strip ON strip.id=stl.trip_id AND strip.company_id=m.company_id
  LEFT JOIN LATERAL (SELECT DISTINCT t.trip_no FROM public.transport_trips t
                      WHERE t.id=stl.trip_id AND t.company_id=m.company_id) supplier_trip ON true
  GROUP BY m.side,m.company_id,m.document_id,m.number,m.document_date,m.status,co.name
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('side',side,'company',company,'invoice_number',number,'date',document_date,'status',status,
   'trips',to_jsonb(trips),'document_id',document_id) ORDER BY document_date DESC,company), '[]'::jsonb)
 INTO out_json FROM (SELECT * FROM rows ORDER BY document_date DESC,company LIMIT 25) q;
 RETURN jsonb_build_object('duplicate_count',jsonb_array_length(coalesce(out_json,'[]'::jsonb)),'matches',coalesce(out_json,'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.transport_invoice_number_conflicts(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_invoice_number_conflicts(text,text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.transport_invoice_duplicate_override_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), side text NOT NULL CHECK(side IN ('customer','supplier')),
 company_id uuid NOT NULL REFERENCES public.companies(id), business_unit_id uuid, document_id uuid NOT NULL,
 invoice_number text NOT NULL, matches jsonb NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transport_invoice_duplicate_override_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transport_invoice_duplicate_override_events FROM PUBLIC,anon,authenticated;

DROP INDEX IF EXISTS public.uq_sales_orders_company_order_no;
DROP INDEX IF EXISTS public.ux_sales_orders_company_order_no;
DROP INDEX IF EXISTS public.purchase_orders_company_unit_order_no_uidx;
DROP INDEX IF EXISTS public.purchase_orders_user_order_no_uidx;
CREATE INDEX IF NOT EXISTS sales_orders_company_order_no_lookup ON public.sales_orders(company_id,lower(btrim(order_no)));
CREATE INDEX IF NOT EXISTS purchase_orders_company_order_no_lookup ON public.purchase_orders(company_id,lower(btrim(order_no)));

CREATE OR REPLACE FUNCTION public.transport_guard_duplicate_invoice_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE side text:=CASE WHEN TG_TABLE_NAME='sales_orders' THEN 'customer' ELSE 'supplier' END;
 number text:=nullif(btrim(NEW.order_no),''); n integer;
 allow_override boolean:=coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0')='1';
 conflict_rows jsonb;
BEGIN
 IF number IS NULL THEN RETURN NEW; END IF;
 IF NEW.company_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':transport-invoice:'||side,0)); END IF;
 IF side='customer' THEN
  SELECT count(*) INTO n FROM public.sales_orders x WHERE x.company_id=NEW.company_id AND lower(btrim(x.order_no))=lower(number) AND x.id IS DISTINCT FROM NEW.id;
 ELSE
  SELECT count(*) INTO n FROM public.purchase_orders x WHERE x.company_id=NEW.company_id AND lower(btrim(x.order_no))=lower(number) AND x.id IS DISTINCT FROM NEW.id;
 END IF;
 IF n=0 THEN RETURN NEW; END IF;
 IF NOT allow_override OR NOT public.transport_invoice_duplicate_override_allowed(side) THEN
  RAISE EXCEPTION 'Invoice number already exists in this company. Review the duplicate list; authorized override is required.';
 END IF;
 conflict_rows:=public.transport_invoice_number_conflicts(side,number)->'matches';
 INSERT INTO public.transport_invoice_duplicate_override_events(side,company_id,business_unit_id,document_id,invoice_number,matches,created_by)
 VALUES(side,NEW.company_id,NEW.business_unit_id,NEW.id,number,coalesce(conflict_rows,'[]'::jsonb),auth.uid());
 RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS transport_guard_duplicate_invoice_number ON public.sales_orders;
CREATE TRIGGER transport_guard_duplicate_invoice_number BEFORE INSERT OR UPDATE OF order_no,company_id ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.transport_guard_duplicate_invoice_number();
DROP TRIGGER IF EXISTS transport_guard_duplicate_invoice_number ON public.purchase_orders;
CREATE TRIGGER transport_guard_duplicate_invoice_number BEFORE INSERT OR UPDATE OF order_no,company_id ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.transport_guard_duplicate_invoice_number();

CREATE OR REPLACE FUNCTION public.transport_guard_duplicate_supplier_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE number text:=nullif(btrim(NEW.supplier_invoice_no),''); allow_override boolean:=coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0')='1'; conflicts jsonb;
BEGIN
 IF number IS NULL THEN RETURN NEW; END IF;
 IF NEW.company_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':transport-invoice:supplier',0)); END IF;
 conflicts:=public.transport_invoice_number_conflicts('supplier',number);
 IF coalesce((conflicts->>'duplicate_count')::integer,0)=0 THEN RETURN NEW; END IF;
 IF NOT allow_override OR NOT public.transport_invoice_duplicate_override_allowed('supplier') THEN
  RAISE EXCEPTION 'Supplier invoice number is already in use. Review the duplicate list; authorized override is required.';
 END IF;
 INSERT INTO public.transport_invoice_duplicate_override_events(side,company_id,business_unit_id,document_id,invoice_number,matches,created_by)
 VALUES('supplier',NEW.company_id,NEW.business_unit_id,NEW.id,number,coalesce(conflicts->'matches','[]'::jsonb),auth.uid());
 RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS transport_guard_duplicate_supplier_reference ON public.purchase_orders;
CREATE TRIGGER transport_guard_duplicate_supplier_reference BEFORE INSERT OR UPDATE OF supplier_invoice_no,company_id ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.transport_guard_duplicate_supplier_reference();

CREATE OR REPLACE FUNCTION public.transport_choose_invoice_number(p_side text,p_number text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c uuid:=public.current_company_id(); n text:=nullif(btrim(p_number),''); attempt integer:=0; conflicts jsonb; used boolean;
 override_on boolean:=coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0')='1';
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR p_side NOT IN ('customer','supplier') THEN RAISE EXCEPTION 'Authenticated invoice workspace required'; END IF;
 IF n IS NOT NULL AND (length(n)>80 OR n ~ '[[:cntrl:]]' OR n LIKE '%-AUTO') THEN
  RAISE EXCEPTION 'Invoice number must be at most 80 characters, without control characters or the reserved -AUTO suffix';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':transport-invoice:'||p_side,0));
 LOOP
  IF n IS NULL THEN n:=public.next_document_number(CASE WHEN p_side='customer' THEN 'sales' ELSE 'purchase' END,CASE WHEN p_side='customer' THEN 'TR-S' ELSE 'TR-P' END); END IF;
  conflicts:=public.transport_invoice_number_conflicts(p_side,n);
  used:=coalesce((conflicts->>'duplicate_count')::integer,0)>0;
  IF NOT used THEN RETURN n; END IF;
  IF nullif(btrim(p_number),'') IS NOT NULL THEN
   IF override_on AND public.transport_invoice_duplicate_override_allowed(p_side) THEN RETURN n; END IF;
   RAISE EXCEPTION 'Invoice number is already in use. Review the conflict details; an authorized duplicate override is required.';
  END IF;
  n:=NULL; attempt:=attempt+1;
  IF attempt>1000 THEN RAISE EXCEPTION 'Automatic invoice number range occupied; review numbering settings'; END IF;
 END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.transport_create_customer_draft_grouped_with_override(
 p_trip_ids uuid[],p_date date,p_revenue_account_id uuid,p_with_tax boolean,p_invoice_no text,p_descriptions jsonb,p_allow_duplicate_invoice boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE previous text; result jsonb;
BEGIN
 IF p_allow_duplicate_invoice AND NOT public.transport_invoice_duplicate_override_allowed('customer') THEN RAISE EXCEPTION 'Duplicate invoice override permission is required'; END IF;
 previous:=coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0');
 PERFORM set_config('app.transport_duplicate_invoice_override',CASE WHEN p_allow_duplicate_invoice THEN '1' ELSE '0' END,true);
 result:=public.transport_create_customer_draft_grouped(p_trip_ids,p_date,p_revenue_account_id,p_with_tax,p_invoice_no,p_descriptions);
 PERFORM set_config('app.transport_duplicate_invoice_override',previous,true);
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.transport_create_customer_draft_grouped_with_override(uuid[],date,uuid,boolean,text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_create_customer_draft_grouped_with_override(uuid[],date,uuid,boolean,text,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_create_supplier_draft_grouped_with_override(
 p_rent_ids uuid[],p_date date,p_cost_account_id uuid,p_with_tax boolean,p_reference text,p_invoice_no text,p_descriptions jsonb,p_allow_duplicate_invoice boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE previous text; result jsonb;
BEGIN
 IF p_allow_duplicate_invoice AND NOT public.transport_invoice_duplicate_override_allowed('supplier') THEN RAISE EXCEPTION 'Duplicate invoice override permission is required'; END IF;
 previous:=coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0');
 PERFORM set_config('app.transport_duplicate_invoice_override',CASE WHEN p_allow_duplicate_invoice THEN '1' ELSE '0' END,true);
 result:=public.transport_create_supplier_draft_grouped(p_rent_ids,p_date,p_cost_account_id,p_with_tax,p_reference,p_invoice_no,p_descriptions);
 PERFORM set_config('app.transport_duplicate_invoice_override',previous,true);
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.transport_create_supplier_draft_grouped_with_override(uuid[],date,uuid,boolean,text,text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_create_supplier_draft_grouped_with_override(uuid[],date,uuid,boolean,text,text,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_normal_invoice_create_vat_with_override(
 p_side text,p_party uuid,p_date date,p_lines jsonb,p_account uuid,p_invoice_no text,p_reference text,p_post boolean,p_vat_choice text,p_allow_duplicate_invoice boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE previous text; result jsonb;
BEGIN
 IF p_allow_duplicate_invoice AND NOT public.transport_invoice_duplicate_override_allowed(p_side) THEN RAISE EXCEPTION 'Duplicate invoice override permission is required'; END IF;
 previous:=coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0');
 PERFORM set_config('app.transport_duplicate_invoice_override',CASE WHEN p_allow_duplicate_invoice THEN '1' ELSE '0' END,true);
 result:=public.transport_normal_invoice_create_vat(p_side,p_party,p_date,p_lines,p_account,p_invoice_no,p_reference,p_post,p_vat_choice);
 PERFORM set_config('app.transport_duplicate_invoice_override',previous,true);
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.transport_normal_invoice_create_vat_with_override(text,uuid,date,jsonb,uuid,text,text,boolean,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_normal_invoice_create_vat_with_override(text,uuid,date,jsonb,uuid,text,text,boolean,text,boolean) TO authenticated;


-- Match customer Register behavior: a fully credited/released supplier
-- adjustment no longer appears as an active billed link; open posted links remain.
CREATE OR REPLACE FUNCTION public.transport_register_supplier_invoice_scope(p_trip_ids uuid[])
RETURNS TABLE(trip_id uuid,purchase_order_id uuid,document_id uuid,rent_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
SET statement_timeout TO '12s'
AS $function$
DECLARE c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL
    OR NOT public.has_module_permission(c,'transport','view') OR NOT public.transport_financial_read_allowed('supplier')
 THEN RAISE EXCEPTION 'Supplier financial permission and active workspace required'; END IF;
 IF p_trip_ids IS NULL OR cardinality(p_trip_ids) NOT BETWEEN 1 AND 100
   OR (SELECT count(DISTINCT x.id) FROM unnest(p_trip_ids) x(id))<>cardinality(p_trip_ids)
   OR (SELECT count(*) FROM public.transport_trips t WHERE t.id=ANY(p_trip_ids) AND t.company_id=c AND t.business_unit_id=b AND t.operating_location_id=loc)<>cardinality(p_trip_ids)
 THEN RAISE EXCEPTION 'Invalid or out-of-scope Trip page'; END IF;
 RETURN QUERY
 WITH orders AS MATERIALIZED (
  SELECT DISTINCT d.purchase_order_id
  FROM public.transport_supplier_document_rents l
  JOIN public.transport_supplier_documents d ON d.id=l.document_id
  JOIN public.purchase_orders po ON po.id=d.purchase_order_id
  LEFT JOIN public.transport_supplier_trip_document_balances bal
   ON bal.purchase_order_id=po.id AND bal.trip_id=l.trip_id AND bal.rent_id=l.rent_id
  WHERE l.trip_id=ANY(p_trip_ids) AND l.company_id=c AND l.business_unit_id=b AND l.operating_location_id=loc
    AND (NOT l.is_adjustment OR (po.status='posted' AND coalesce(bal.outstanding_gross,0)>0.01))
 ), all_lines AS (
  SELECT l.trip_id,d.purchase_order_id,l.document_id,l.rent_id
  FROM orders o
  JOIN public.transport_supplier_documents d ON d.purchase_order_id=o.purchase_order_id
  JOIN public.transport_supplier_document_rents l ON l.document_id=d.id
  JOIN public.purchase_orders po ON po.id=d.purchase_order_id
  LEFT JOIN public.transport_supplier_trip_document_balances bal
   ON bal.purchase_order_id=po.id AND bal.trip_id=l.trip_id AND bal.rent_id=l.rent_id
  WHERE l.company_id=c AND l.business_unit_id=b AND l.operating_location_id=loc
    AND (NOT l.is_adjustment OR (po.status='posted' AND coalesce(bal.outstanding_gross,0)>0.01))
 )
 SELECT x.trip_id,x.purchase_order_id,x.document_id,x.rent_id FROM all_lines x;
END $function$;
