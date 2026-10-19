-- Future-only validation: Normal Transport Sales require one company Vehicle Master
-- per description line (UI, manual RPC and Excel import). Trip Service invoices
-- remain linked to their original Trips and Service Revenue. No posted rows changed.
do $migration$
declare
  f text;
  existing_vehicle_rule text := $old$
IF selected_vehicle IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.transport_vehicles v
      JOIN public.transport_vehicle_ownership o ON o.vehicle_id=v.id
       AND o.company_id=v.company_id AND o.business_unit_id=v.business_unit_id
      WHERE v.id=selected_vehicle AND v.company_id=c AND v.business_unit_id=b
       AND v.is_active AND o.owner_type='company'
       AND o.effective_from<=p_date AND (o.effective_to IS NULL OR o.effective_to>=p_date)
    ) THEN RAISE EXCEPTION 'Select a company-owned Vehicle valid on invoice date'; END IF;$old$;
  required_vehicle_rule text := $new$
IF selected_vehicle IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.transport_vehicles v
      WHERE v.id=selected_vehicle AND v.company_id=c AND v.business_unit_id=b
        AND v.is_active
        AND (
          EXISTS(
            SELECT 1 FROM public.transport_vehicle_ownership o
            WHERE o.vehicle_id=v.id AND o.company_id=c AND o.business_unit_id=b
              AND o.owner_type='company'
              AND o.effective_from<=p_date
              AND (o.effective_to IS NULL OR o.effective_to>=p_date)
          )
          OR (
            v.ownership_type='company'
            AND NOT EXISTS(
              SELECT 1 FROM public.transport_vehicle_ownership o
              WHERE o.vehicle_id=v.id AND o.company_id=c AND o.business_unit_id=b
            )
          )
        )
    ) THEN RAISE EXCEPTION 'Every Normal Sale line requires a company-owned Vehicle Master valid on invoice date'; END IF;$new$;
  old_import text := $oldimport$
SELECT jsonb_agg(jsonb_build_object('description',z->>'description','amount',z->>'amount')) INTO lines$oldimport$;
  new_import text := $newimport$
SELECT jsonb_agg(jsonb_build_object('description',z->>'description','amount',z->>'amount','vehicle_id',z->>'vehicle_id')) INTO lines$newimport$;
begin
  f:=pg_get_functiondef('public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean)'::regprocedure);
  -- Match stable statement boundaries, not pretty-printed whitespace from
  -- pg_get_functiondef: production and replayed migrations can differ in indent.
  if position(required_vehicle_rule in f)=0 then
    if strpos(f,'IF selected_vehicle IS NOT NULL AND NOT EXISTS (')=0
       or strpos(f,'INSERT INTO public.sales_service_lines')<=strpos(f,'IF selected_vehicle IS NOT NULL AND NOT EXISTS (')
    then raise exception 'Normal Sales vehicle posting function changed; migration halted';end if;
    execute left(f,strpos(f,'IF selected_vehicle IS NOT NULL AND NOT EXISTS (')-1)
      || required_vehicle_rule || chr(10)||'    '
      || substring(f from strpos(f,'INSERT INTO public.sales_service_lines'));
  end if;
  f:=pg_get_functiondef('public.transport_normal_invoice_import(text,jsonb,boolean)'::regprocedure);
  if position(old_import in f)=0 then
    if position(new_import in f)=0 then
      raise exception 'Normal Sales Excel import function changed; migration halted';
    end if;
  else
    execute replace(f,old_import,new_import);
  end if;
end $migration$;
