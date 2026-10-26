-- Keep globally visible duplicate detection for authorized overrides, but never
-- return another company's invoice identity, date, status, or Trip to this workspace.
CREATE OR REPLACE FUNCTION public.transport_invoice_number_conflicts(p_side text,p_number text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE c uuid:=public.current_company_id(); out_json jsonb; total_count integer; hidden_count integer;
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
  GROUP BY m.side,m.company_id,m.document_id,m.number,m.document_date,m.status,co.name
 ), summary AS (
  SELECT count(*)::integer total_count,count(*) FILTER(WHERE company_id<>c)::integer hidden_count FROM rows
 ), visible AS (
  SELECT * FROM rows WHERE company_id=c ORDER BY document_date DESC,company LIMIT 25
 )
 SELECT summary.total_count,summary.hidden_count,
   coalesce((SELECT jsonb_agg(jsonb_build_object('side',side,'company',company,'invoice_number',number,'date',document_date,'status',status,
     'trips',to_jsonb(trips),'document_id',document_id) ORDER BY document_date DESC,company) FROM visible),'[]'::jsonb)
 INTO total_count,hidden_count,out_json FROM summary;
 IF hidden_count>0 THEN
  out_json:=out_json||jsonb_build_array(jsonb_build_object(
    'side',p_side,'company',NULL,'invoice_number',NULL,'date',NULL,'status',NULL,
    'trips','[]'::jsonb,'document_id',NULL,'restricted',true));
 END IF;
 RETURN jsonb_build_object('duplicate_count',total_count,'matches',coalesce(out_json,'[]'::jsonb),'restricted_count',hidden_count);
END $function$;
REVOKE ALL ON FUNCTION public.transport_invoice_number_conflicts(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_invoice_number_conflicts(text,text) TO authenticated;
