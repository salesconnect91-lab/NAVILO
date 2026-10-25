-- Permit Admin-authorized deletion of fully entered but still unposted trips.
-- Posted documents, allocations, journals and other financial evidence stay blocked.
create or replace function public.transport_delete_draft_trip(p_trip_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype; snapshot jsonb; reason text:=nullif(btrim(p_reason),'');
begin
 if auth.uid() is null or not public.has_transport_action_permission(public.current_company_id(),'trip_delete')
 then raise exception 'Trip delete permission required'; end if;
 if reason is null or length(reason)>1000 then raise exception 'Deletion reason is required (maximum 1000 characters)'; end if;
 if not exists(select 1 from public.business_units where id=public.current_business_unit_id() and company_id=public.current_company_id() and unit_type='transport' and is_active)
 then raise exception 'Active Transport Business Unit required'; end if;
 select * into t from public.transport_trips where id=p_trip_id
 and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and operating_location_id=public.current_operating_location_id() for update;
 if not found then raise exception 'Trip not found in the active company, Business Unit and branch'; end if;
 if t.status is distinct from 'draft'
 or public.transport_canonical_trip_status(t.id,false,false,0,0) not in ('draft','incomplete','complete')
 then raise exception 'Only an unposted Draft, Incomplete or Complete Trip without financial entries may be deleted'; end if;
 if t.sales_order_id is not null
 or exists(select 1 from public.sales_service_lines where source_module in ('transport','transport_trip') and source_id=t.id)
 or exists(select 1 from public.purchase_service_lines where source_module in ('transport','transport_trip') and (source_id=t.id or source_id in (select id from public.transport_trip_supplier_rents where trip_id=t.id)))
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id)
 or exists(select 1 from public.transport_supplier_document_rents where trip_id=t.id)
 or exists(select 1 from public.transport_driver_accrual_attributions where trip_id=t.id)
 or exists(select 1 from public.transport_driver_payment_attributions where trip_id=t.id)
 or exists(select 1 from public.transport_service_cost_links where trip_id=t.id)
 or exists(select 1 from public.transport_trip_expenses where trip_id=t.id)
 or exists(select 1 from public.transport_driver_expenses where trip_id=t.id)
 or exists(select 1 from public.transport_rate_adjustments where trip_id=t.id)
 or exists(select 1 from public.transport_financial_assignment_history where trip_id=t.id)
 or exists(select 1 from public.transport_driver_month_adjustments where trip_id=t.id)
 then raise exception 'Trip has financial entries or documents. Use the correction / reversal workflow'; end if;
 snapshot:=to_jsonb(t)||jsonb_build_object(
 'deleted_supplier_rents',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.transport_trip_supplier_rents r where trip_id=t.id),
 'deleted_customer_charges',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.transport_trip_customer_charges r where trip_id=t.id),
 'deleted_supplier_charges',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.transport_trip_supplier_charges r where trip_id=t.id),
 'deleted_assignments',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.transport_trip_assignments r where trip_id=t.id),
 'deleted_locations',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.transport_trip_locations r where trip_id=t.id));
 insert into public.transport_action_gate values(txid_current(),t.id,'trip_delete');
 insert into public.transport_trip_audit(company_id,business_unit_id,operating_location_id,trip_id,trip_no,action,old_value,reason,actor_id,source)
 values(t.company_id,t.business_unit_id,t.operating_location_id,null,t.trip_no,'delete',snapshot,reason,auth.uid(),'Transport Register: Delete Unposted Trip');
 delete from public.transport_trip_supplier_charges where trip_id=t.id;
 delete from public.transport_trip_customer_charges where trip_id=t.id;
 delete from public.transport_trip_supplier_rents where trip_id=t.id;
 delete from public.transport_trip_assignments where trip_id=t.id;
 delete from public.transport_trip_locations where trip_id=t.id;
 delete from public.transport_trips where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='trip_delete';
 return jsonb_build_object('deleted',true,'trip_no',t.trip_no);
end $$;
revoke all on function public.transport_delete_draft_trip(uuid,text) from public,anon;
grant execute on function public.transport_delete_draft_trip(uuid,text) to authenticated;
