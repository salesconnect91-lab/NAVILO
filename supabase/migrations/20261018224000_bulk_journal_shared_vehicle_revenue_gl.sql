-- Excel Journal Vehicle No is a dimension; preserve the selected revenue GL.
-- Legacy unique dedicated vehicle income accounts remain protected.
DO $navilo$
DECLARE f text; a integer; b integer;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='bulk_load_journal_entries';
 IF md5(f) IS DISTINCT FROM 'd0e3355a2f91130a526d930aa383d6a1'
 THEN RAISE EXCEPTION 'Bulk journal import function changed; refuse patch'; END IF;
 a:=strpos(f,'          IF v_linked_income_account IS NULL OR v_linked_income_account<>v_account.id THEN');
 b:=a+strpos(substring(f from a),'        ELSIF EXISTS(')-1;
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'Bulk journal Income guard anchors not found';END IF;
 EXECUTE left(f,a-1)||$replacement$
          -- A common Revenue account is valid with an explicit company vehicle.
          -- Only prevent assigning a uniquely dedicated legacy Income GL to a different vehicle.
          IF v_linked_income_account IS DISTINCT FROM v_account.id
             AND (SELECT count(*) FROM public.transport_vehicles v
                  WHERE v.company_id=v_company_id AND v.business_unit_id=v_business_unit_id
                    AND v.revenue_account_id=v_account.id AND v.is_active)=1
             AND NOT EXISTS (SELECT 1 FROM public.account_mappings m
                  WHERE m.company_id=v_company_id AND m.account_id=v_account.id
                    AND m.mapping_key IN ('service_revenue','sales_revenue','sales'))
          THEN RAISE EXCEPTION '%: selected legacy Vehicle Income GL belongs to another Vehicle.',v_entry_no; END IF;
$replacement$||substring(f from b);
END $navilo$;
