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
SELECT jsonb_agg(jsonb_build_object('description',z->>'description','amount',z->>'amount','vehicle_id',z->>'vehicle_id'))$newimport$;
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
  if position(new_import in f)=0 then
    if strpos(f,'SELECT jsonb_agg(')=0
      or strpos(f,' INTO lines')<=strpos(f,'SELECT jsonb_agg(')
    then raise exception 'Normal Sales Excel import function changed; migration halted';end if;
    execute left(f,strpos(f,'SELECT jsonb_agg(')-1)
      || new_import
      || substring(f from strpos(f,' INTO lines'));
  end if;
end $migration$;

-- Normal Sales lines may repeat the same vehicle within one invoice. Preserve
-- the vehicle dimension in transport_vehicle_id while leaving source_id NULL:
-- (order_id,source_module,source_id) is a source-identity UNIQUE constraint.
-- Existing posted source IDs, Purchase lines, Trip lines and GL remain untouched.
do $normal_line_identity$
declare
 f text; start_at int; end_at int; chunk text; updated text;
begin
 f:=pg_get_functiondef('public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean)'::regprocedure);
 start_at:=strpos(f,'INSERT INTO public.sales_service_lines(');
 end_at:=strpos(f,'IF p_post THEN outcome:=public.post_sales_invoice',start_at);
 if start_at=0 or end_at<=start_at then
   raise exception 'Normal Sales service-line insertion changed; migration halted';
 end if;
 chunk:=substring(f from start_at for end_at-start_at);
 if position('transport_vehicle_id,created_by' in chunk)=0 then
   if position('source_id,created_by' in chunk)=0 or
      position('selected_vehicle,auth.uid()' in chunk)=0 then
     raise exception 'Normal Sales service-line source identity changed; migration halted';
   end if;
   updated:=replace(chunk,'source_id,created_by','source_id,transport_vehicle_id,created_by');
   updated:=replace(updated,'selected_vehicle,auth.uid()','NULL,selected_vehicle,auth.uid()');
   execute left(f,start_at-1)||updated||substring(f from end_at);
 end if;
end $normal_line_identity$;

CREATE OR REPLACE FUNCTION public.guard_normal_invoice_vehicle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $normal_vehicle_trigger$
declare dt date;
begin
 if new.source_module is distinct from 'transport_normal_vehicle' then
   new.transport_vehicle_id:=null;
   return new;
 end if;
 if new.source_id is not null AND new.transport_vehicle_id is not null
    AND new.source_id<>new.transport_vehicle_id then
   raise exception 'Normal invoice vehicle references disagree';
 end if;
 new.transport_vehicle_id:=coalesce(new.transport_vehicle_id,new.source_id);
 if tg_table_name='sales_service_lines' then
   select order_date into dt from public.sales_orders where id=new.order_id
    and company_id=new.company_id and business_unit_id=new.business_unit_id;
 else
   select order_date into dt from public.purchase_orders where id=new.order_id
    and company_id=new.company_id and business_unit_id=new.business_unit_id;
 end if;
 if new.transport_vehicle_id is null or not exists(
    select 1 from public.transport_vehicles v
    where v.id=new.transport_vehicle_id and v.company_id=new.company_id
      and v.business_unit_id=new.business_unit_id and v.is_active
      and (
        exists(
          select 1 from public.transport_vehicle_ownership o
          where o.vehicle_id=v.id and o.company_id=v.company_id
           and o.business_unit_id=v.business_unit_id and o.owner_type='company'
           and o.effective_from<=dt and (o.effective_to is null or o.effective_to>=dt)
        )
        or (v.ownership_type='company' and not exists(
          select 1 from public.transport_vehicle_ownership o
          where o.vehicle_id=v.id and o.company_id=v.company_id and o.business_unit_id=v.business_unit_id
        ))
      )
 ) then
   raise exception 'Select a company-owned vehicle valid on invoice date';
 end if;
 return new;
end $normal_vehicle_trigger$;
