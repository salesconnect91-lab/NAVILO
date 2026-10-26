-- A single indexed, permission-scoped read for Register commercial popups.
BEGIN;
CREATE OR REPLACE FUNCTION public.transport_bulk_rate_page(p_side text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
begin
 if (coalesce(p_filters->'columns','{}') ?| array['rate','rateStatus']) and not public.transport_financial_read_allowed('customer') then raise exception 'Customer financial view permission required';end if;
 if (coalesce(p_filters->'columns','{}') ?| array['rent','rentStatus','owner']) and not public.transport_financial_read_allowed('supplier') then raise exception 'Supplier financial view permission required';end if;
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>100000 then raise exception 'Invalid bulk filters';end if;
 with base as materialized (
  select t.id,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,t.trip_date,coalesce(t.lifecycle_status,t.status) trip_status,t.customer_id,coalesce(cu.name,t.customer_name_snapshot) customer_name,
   v.vehicle_no,dr.driver_name,t.from_location,t.to_location,t.po_do_job_no,t.sale_type,t.customer_rate,t.customer_rate_state,
   t.sales_order_id,t.owner_supplier_id,t.owner_name_snapshot,t.supplier_rent,t.owner_rent,t.rent_state,t.rent_finalized_at,
   (t.sales_order_id is not null or exists(select 1 from public.transport_customer_document_trips l where l.trip_id=t.id)) customer_rate_locked,
   case when p_side='customer' and coalesce(p_filters->>'unpostedOnly','false')<>'true' then (select r.billed_customer_net from public.transport_financial_register r where r.id=t.id) end billed_customer_net /* skip_bulk_billed_lookup */
  from public.transport_trips t left join public.customers cu on cu.id=t.customer_id
  left join public.transport_vehicles v on v.id=t.vehicle_id left join public.transport_drivers dr on dr.id=t.driver_id
  where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
   and (p_side <> 'customer' or coalesce(p_filters->>'unpostedOnly','false') <> 'true'
    or (t.sales_order_id is null and not exists (select 1 from public.transport_customer_document_trips l where l.trip_id=t.id)))
   and (coalesce(p_filters->>'initialTrip','')='' or t.id=CASE WHEN p_filters->>'initialTrip' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_filters->>'initialTrip')::uuid ELSE NULL END)
   and (coalesce(p_filters->>'status','')='' or t.status=p_filters->>'status')
   and (coalesce(p_filters->>'search','')='' or position(lower(btrim(p_filters->>'search')) in lower(concat_ws(' ',public.transport_display_trip_no(t.id,t.trip_no),t.po_do_job_no,cu.name,t.customer_name_snapshot,dr.driver_name,v.vehicle_no,t.from_location,t.to_location)))>0)
 ), lines as materialized (
  select to_jsonb(t)||jsonb_build_object('posted',t.customer_rate_locked) row,
   t.customer_id party,t.trip_date,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,t.id::text key,
   case when t.customer_rate_locked then 'posted correction required' when t.customer_rate_state='finalized' then 'finalized editable until post' else 'pending ready to finalize' end state
  from base t where p_side='customer'
  union all
  select to_jsonb(t)||jsonb_build_object('id',coalesce(r.id::text,'new:'||t.id::text),'trip_id',t.id,'party_id',coalesce(r.supplier_id,t.owner_supplier_id),
   'owner_name',coalesce(s.name,r.supplier_name_snapshot,t.owner_name_snapshot),
   'posted',exists(
    select 1 from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    join public.transport_active_journals j on j.id=d.journal_entry_id
    where l.rent_id=r.id and not l.is_adjustment),
   'draftLinked',exists(
    select 1 from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    join public.purchase_orders po on po.id=d.purchase_order_id
    where l.rent_id=r.id and not l.is_adjustment and po.status='draft'
      and not exists(select 1 from public.transport_active_journals j where j.id=d.journal_entry_id)),
   'legacyBlocked',r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null),
   'supplier_rent',coalesce(r.amount+a.difference,t.supplier_rent,t.owner_rent),
   'owner_rent',coalesce(r.amount+a.difference,t.supplier_rent,t.owner_rent),
   'billed_supplier_net',case when exists(
    select 1 from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    join public.transport_active_journals j on j.id=d.journal_entry_id
    where l.rent_id=r.id and not l.is_adjustment) then r.amount+a.difference end,
   'rent',case when r.id is not null then to_jsonb(r)||jsonb_build_object('trip_id',t.id,'amount',r.amount+a.difference,'finalized_amount_snapshot',r.amount+a.difference) end),
   coalesce(r.supplier_id,t.owner_supplier_id),t.trip_date,public.transport_display_trip_no(t.id,t.trip_no) AS trip_no,coalesce(r.id::text,'new:'||t.id::text),
   case when exists(
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
    when r.id is null and (t.rent_state='finalized' or t.rent_finalized_at is not null) then 'legacy correction required'
    when r.state='finalized' then 'finalized editable until post' else 'pending ready to finalize' end
  from base t left join public.transport_trip_supplier_rents r on r.trip_id=t.id
  left join public.suppliers s on s.id=coalesce(r.supplier_id,t.owner_supplier_id)
  left join lateral(select coalesce(sum(difference),0) difference from public.transport_rate_adjustments a where a.rent_id=r.id and a.side='supplier') a on true
  where p_side='supplier'
 ), cells as (
  select l.*,jsonb_build_object('trip',row->>'trip_no','date',to_char(trip_date,'DD-Mon-YY'),'status',coalesce(row->>'trip_status','—'),
   'company',row->>'customer_name','route',coalesce(row->>'from_location','')||' '||coalesce(row->>'to_location',''),
   'vehicle',row->>'vehicle_no','driver',row->>'driver_name','job',row->>'po_do_job_no','sale',row->>'sale_type','owner',row->>'owner_name',
   'rate',case when (row->>'posted')::boolean then row->>'billed_customer_net' else row->>'customer_rate' end,
   'rent',row->>'supplier_rent','rateStatus',state,'rentStatus',state) as cell_values from lines l
 ), filtered as materialized (
  select * from cells x where (coalesce(p_filters->>'party','')='' or x.party::text=p_filters->>'party')
   and not exists(select 1 from jsonb_each_text(coalesce(p_filters->'columns','{}')) f
    where btrim(f.value)<>'' and position(
 lower(case when f.key in ('rate','rent') then replace(btrim(f.value),',','') else regexp_replace(btrim(f.value),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end)
 in lower(case when f.key in ('rate','rent') then replace(coalesce(x.cell_values->>f.key,''),',','') else regexp_replace(coalesce(x.cell_values->>f.key,''),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end))=0)
 ), page as (select row||jsonb_build_object('invoice_no',case when p_side='customer' then
 (select so.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where l.trip_id=(row->>'id')::uuid and not l.is_adjustment order by l.id limit 1)
 else (select po.order_no from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where l.rent_id=(row->'rent'->>'id')::uuid and not l.is_adjustment order by l.id limit 1) end) row from filtered order by trip_date desc,trip_no desc,key
  limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from page),'[]'),'count',(select count(*) from filtered),
  'amount',coalesce((select sum(case when p_side='supplier' then (row->>'supplier_rent')::numeric when (row->>'posted')::boolean then (row->>'billed_customer_net')::numeric else (row->>'customer_rate')::numeric end) from filtered),0),
  'statuses',coalesce((select jsonb_agg(status) from (select distinct trip_status status from base) s),'[]')) into answer;
 answer:=jsonb_set(answer,'{rows}',coalesce((select jsonb_agg(public._transport_mask_financial_row(value,cv,sv)) from jsonb_array_elements(answer->'rows')),'[]'));return answer;
end $function$
;
CREATE OR REPLACE FUNCTION navilo_private.transport_register_popup_context(p_trip_id uuid,p_side text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $ctx$
DECLARE c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();t public.transport_trips%rowtype;trip jsonb;types jsonb;lines jsonb;rates jsonb;invoices jsonb;page jsonb;permissions jsonb;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL OR p_side IS NULL OR p_side NOT IN ('customer','supplier')
 OR NOT public.has_module_permission(c,'transport','view') OR NOT public.transport_financial_read_allowed(p_side) THEN RAISE EXCEPTION 'Financial view permission and active Transport workspace required';END IF;
 SELECT * INTO t FROM public.transport_trips WHERE id=p_trip_id AND company_id=c AND business_unit_id=b AND operating_location_id=loc;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found in the active workspace and branch';END IF;
 trip:=public.transport_edit_trip_read(t.id);
 trip:=trip||jsonb_build_object('customer_name',coalesce((SELECT name FROM public.customers WHERE id=t.customer_id AND company_id=c),t.customer_name_snapshot),'vehicle_no',(SELECT vehicle_no FROM public.transport_vehicles WHERE id=t.vehicle_id AND company_id=c AND business_unit_id=b),'driver_name',(SELECT driver_name FROM public.transport_drivers WHERE id=t.driver_id AND company_id=c AND business_unit_id=b));
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'code',charge_key,'name',charge_name,'is_active',is_active,'default_rate',default_rate) ORDER BY charge_key,id),'[]') INTO types FROM public.charge_master WHERE company_id=c AND is_active AND applies_to IN (CASE WHEN p_side='customer' THEN 'sales' ELSE 'purchase' END,'both');
 IF p_side='customer' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.id),'[]') INTO lines FROM public.transport_trip_customer_charges x WHERE x.trip_id=t.id AND x.company_id=c AND x.business_unit_id=b;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'charge_master_id',charge_master_id,'amount',amount,'status',status,'effective_from',effective_from,'effective_to',effective_to)),'[]') INTO rates FROM public.transport_customer_charge_rates WHERE company_id=c AND business_unit_id=b AND customer_id=t.customer_id AND is_active;
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id',o.id,'document_id',d.id,'order_no',o.order_no,'order_date',o.order_date,'status',o.status,'total',o.total)),'[]') INTO invoices FROM public.transport_customer_document_trips x JOIN public.transport_customer_documents d ON d.id=x.document_id JOIN public.sales_orders o ON o.id=d.sales_order_id WHERE x.trip_id=t.id AND NOT x.is_adjustment AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc;
  trip:=trip||jsonb_build_object('posted',public.transport_customer_side_posted(t.id),'draft_linked',EXISTS(SELECT 1 FROM jsonb_array_elements(invoices) i WHERE i->>'status'='draft'));
  permissions:=jsonb_build_object('rate_finalize',public.has_transport_action_permission(c,'customer_rate_finalize'),'rate_override',public.has_transport_action_permission(c,'customer_rate_override'),'adjustment',public.transport_finance_allowed('adjustment'));
 ELSE
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.id),'[]') INTO lines FROM public.transport_trip_supplier_charges x WHERE x.trip_id=t.id AND x.company_id=c AND x.business_unit_id=b;
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id',o.id,'document_id',d.id,'order_no',o.order_no,'order_date',o.order_date,'status',o.status,'total',o.total)),'[]') INTO invoices FROM public.transport_supplier_document_rents x JOIN public.transport_supplier_documents d ON d.id=x.document_id JOIN public.purchase_orders o ON o.id=d.purchase_order_id WHERE x.trip_id=t.id AND NOT x.is_adjustment AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc;
  page:=public.transport_bulk_rate_page('supplier',500,0,jsonb_build_object('initialTrip',t.id));
  permissions:=jsonb_build_object('rent_finalize',public.has_transport_action_permission(c,'rent_finalize'),'rent_correct',public.has_transport_action_permission(c,'rent_correct'),'rent',public.transport_finance_allowed('rent'),'adjustment',public.transport_finance_allowed('adjustment'));
 END IF;
 RETURN jsonb_build_object('trip',trip,'side',p_side,'charge_types',types,'charge_lines',lines,'charge_rates',coalesce(rates,'[]'),'invoices',invoices,'supplier_page',page,'permissions',permissions,'draft_permissions',public.transport_draft_invoice_permissions());
END $ctx$;
REVOKE ALL ON FUNCTION navilo_private.transport_register_popup_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION navilo_private.transport_register_popup_context(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_register_popup_context(p_trip_id uuid,p_side text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT navilo_private.transport_register_popup_context(p_trip_id,p_side) $$;
REVOKE ALL ON FUNCTION public.transport_register_popup_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_register_popup_context(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_save_customer_rate_and_charges(p_trip_id uuid,p_base_amount numeric,p_lines jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $save$
DECLARE t public.transport_trips%rowtype;
BEGIN
 IF auth.uid() IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Authenticated user and audit reason required';END IF;
 SELECT * INTO t FROM public.transport_trips WHERE id=p_trip_id AND company_id=public.current_company_id() AND business_unit_id=public.current_business_unit_id() AND operating_location_id=public.current_operating_location_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found in active workspace and branch';END IF;
 IF t.customer_rate_state='finalized' THEN PERFORM public.transport_finalize_customer_rate(t.id,p_base_amount,'manual',p_reason);
 ELSE PERFORM public.transport_finalize_initial_customer_rate(t.id,p_base_amount);END IF;
 PERFORM public.transport_replace_trip_customer_charges(t.id,p_lines,p_reason);
 RETURN jsonb_build_object('saved',true,'trip_id',t.id);
END $save$;
REVOKE ALL ON FUNCTION public.transport_save_customer_rate_and_charges(uuid,numeric,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_save_customer_rate_and_charges(uuid,numeric,jsonb,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.transport_save_supplier_rate_and_charges(p_trip_id uuid,p_rent_id uuid,p_supplier_id uuid,p_base_amount numeric,p_lines jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $save$
DECLARE t public.transport_trips%rowtype;r public.transport_trip_supplier_rents%rowtype;rid uuid;
BEGIN
 IF auth.uid() IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Authenticated user and audit reason required';END IF;
 SELECT * INTO t FROM public.transport_trips WHERE id=p_trip_id AND company_id=public.current_company_id() AND business_unit_id=public.current_business_unit_id() AND operating_location_id=public.current_operating_location_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found in active workspace and branch';END IF;
 IF p_rent_id IS NULL THEN rid:=public.transport_add_supplier_rent(t.id,p_supplier_id,p_base_amount,p_reason);
 ELSE
  SELECT * INTO r FROM public.transport_trip_supplier_rents WHERE id=p_rent_id AND trip_id=t.id AND company_id=t.company_id AND business_unit_id=t.business_unit_id FOR UPDATE;
  IF NOT FOUND OR r.supplier_id IS DISTINCT FROM p_supplier_id THEN RAISE EXCEPTION 'Supplier rent does not match the selected Trip and supplier';END IF;
  rid:=r.id;
 END IF;
 PERFORM public.transport_finalize_supplier_rent(rid,p_base_amount,p_reason);
 PERFORM public.transport_replace_trip_supplier_charges(rid,p_lines,p_reason);
 RETURN jsonb_build_object('saved',true,'trip_id',t.id,'rent_id',rid);
END $save$;
REVOKE ALL ON FUNCTION public.transport_save_supplier_rate_and_charges(uuid,uuid,uuid,numeric,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_save_supplier_rate_and_charges(uuid,uuid,uuid,numeric,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
