-- Staged only. Read-only, invoker-RLS pagination and summary for commercial invoices.
CREATE OR REPLACE FUNCTION public.commercial_invoice_list_query(
 p_side text,p_search text DEFAULT '',p_status text DEFAULT 'all',p_payment text DEFAULT 'all',
 p_type text DEFAULT 'all',p_from date DEFAULT NULL,p_to date DEFAULT NULL,
 p_sort text DEFAULT 'created_at',p_desc boolean DEFAULT true,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
WITH sources AS (
 SELECT s.id,s.order_no,s.order_date,s.created_at,s.status,s.payment_status,
 s.invoice_type,s.total,s.outstanding_amount,s.customer_id party_id,c.name party_name,s.sales_person
 FROM public.sales_orders s LEFT JOIN public.customers c ON c.id=s.customer_id AND c.company_id=s.company_id
 WHERE p_side='sales'
 UNION ALL
 SELECT p.id,p.order_no,p.order_date,p.created_at,p.status,p.payment_status,
 p.invoice_type,p.total,p.outstanding_amount,p.supplier_id,sup.name,NULL::text
 FROM public.purchase_orders p LEFT JOIN public.suppliers sup ON sup.id=p.supplier_id AND sup.company_id=p.company_id
 WHERE p_side='purchase'
), filtered AS MATERIALIZED (
 SELECT * FROM sources WHERE
 (trim(COALESCE(p_search,''))='' OR order_no ILIKE '%'||trim(p_search)||'%'
 OR party_name ILIKE '%'||trim(p_search)||'%' OR sales_person ILIKE '%'||trim(p_search)||'%'
 OR status ILIKE '%'||trim(p_search)||'%' OR order_date::text ILIKE '%'||trim(p_search)||'%')
 AND (COALESCE(p_status,'all')='all' OR status=p_status)
 AND (COALESCE(p_payment,'all')='all' OR COALESCE(payment_status,'unpaid')=p_payment)
 AND (COALESCE(p_type,'all')='all' OR (p_type='with-tax' AND invoice_type='Tax Invoice')
 OR (p_type='without-tax' AND invoice_type IS DISTINCT FROM 'Tax Invoice'))
 AND (p_from IS NULL OR order_date>=p_from) AND (p_to IS NULL OR order_date<=p_to)
), numbered AS (
 SELECT f.*,row_number() OVER (ORDER BY
 CASE WHEN p_sort='order_no' AND NOT p_desc THEN order_no END ASC NULLS LAST,
 CASE WHEN p_sort='order_no' AND p_desc THEN order_no END DESC NULLS LAST,
 CASE WHEN p_sort IN('customer','supplier','party_name') AND NOT p_desc THEN party_name END ASC NULLS LAST,
 CASE WHEN p_sort IN('customer','supplier','party_name') AND p_desc THEN party_name END DESC NULLS LAST,
 CASE WHEN p_sort='status' AND NOT p_desc THEN status END ASC NULLS LAST,
 CASE WHEN p_sort='status' AND p_desc THEN status END DESC NULLS LAST,
 CASE WHEN p_sort='payment_status' AND NOT p_desc THEN payment_status END ASC NULLS LAST,
 CASE WHEN p_sort='payment_status' AND p_desc THEN payment_status END DESC NULLS LAST,
 CASE WHEN p_sort='invoice_type' AND NOT p_desc THEN invoice_type END ASC NULLS LAST,
 CASE WHEN p_sort='invoice_type' AND p_desc THEN invoice_type END DESC NULLS LAST,
 CASE WHEN p_sort='sales_person' AND NOT p_desc THEN sales_person END ASC NULLS LAST,
 CASE WHEN p_sort='sales_person' AND p_desc THEN sales_person END DESC NULLS LAST,
 CASE WHEN p_sort='total' AND NOT p_desc THEN total END ASC NULLS LAST,
 CASE WHEN p_sort='total' AND p_desc THEN total END DESC NULLS LAST,
 CASE WHEN p_sort='outstanding_amount' AND NOT p_desc THEN outstanding_amount END ASC NULLS LAST,
 CASE WHEN p_sort='outstanding_amount' AND p_desc THEN outstanding_amount END DESC NULLS LAST,
 CASE WHEN p_sort='order_date' AND NOT p_desc THEN order_date END ASC NULLS LAST,
 CASE WHEN p_sort='order_date' AND p_desc THEN order_date END DESC NULLS LAST,
 CASE WHEN p_sort='created_at' AND NOT p_desc THEN created_at END ASC NULLS LAST,
 CASE WHEN p_sort='created_at' AND p_desc THEN created_at END DESC NULLS LAST,
 created_at DESC NULLS LAST,id DESC) seq FROM filtered f
)
SELECT jsonb_build_object(
 'rows',COALESCE((SELECT jsonb_agg(page.doc ORDER BY page.seq) FROM (
   SELECT n.seq,to_jsonb(s)||jsonb_build_object('customer',jsonb_build_object('name',c.name)) doc
   FROM numbered n
   JOIN public.sales_orders s ON s.id=n.id
   LEFT JOIN public.customers c ON c.id=s.customer_id AND c.company_id=s.company_id
   WHERE p_side='sales'
     AND n.seq>GREATEST(COALESCE(p_offset,0),0)
     AND n.seq<=GREATEST(COALESCE(p_offset,0),0)+LEAST(GREATEST(COALESCE(p_limit,25),1),250)
   UNION ALL
   SELECT n.seq,to_jsonb(p)||jsonb_build_object('supplier',jsonb_build_object('name',sup.name))
   FROM numbered n
   JOIN public.purchase_orders p ON p.id=n.id
   LEFT JOIN public.suppliers sup ON sup.id=p.supplier_id AND sup.company_id=p.company_id
   WHERE p_side='purchase'
     AND n.seq>GREATEST(COALESCE(p_offset,0),0)
     AND n.seq<=GREATEST(COALESCE(p_offset,0),0)+LEAST(GREATEST(COALESCE(p_limit,25),1),250)
 ) page), '[]'::jsonb),
 'count',(SELECT count(*) FROM filtered),
 'total',(SELECT COALESCE(sum(total),0) FROM filtered),
 'balance',(SELECT COALESCE(sum(outstanding_amount),0) FROM filtered),
 'parties',(SELECT count(DISTINCT party_id) FROM filtered)) 
$fn$;
REVOKE ALL ON FUNCTION public.commercial_invoice_list_query(text,text,text,text,text,date,date,text,boolean,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_invoice_list_query(text,text,text,text,text,date,date,text,boolean,integer,integer) TO authenticated;