-- Operational manufacturing workflow: planning, shop-floor sequencing, QC disposition and maintenance.

create or replace function public.schedule_work_order(p_work_order_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.work_orders%rowtype; v_ops integer:=0; v_materials integer:=0;
begin
 perform public.assert_module_permission('production','edit');
 select * into w from public.work_orders where id=p_work_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Work order not found in the active business unit.'; end if;
 if w.status<>'planned' then raise exception 'Only planned work orders can be scheduled.'; end if;
 if w.bom_version_id is null or not exists(select 1 from public.bom_versions b where b.id=w.bom_version_id and b.status='approved') then raise exception 'An approved BOM is required.'; end if;
 v_materials:=public.generate_work_order_material_requirements(w.id);
 insert into public.production_operations(company_id,business_unit_id,work_order_id,routing_operation_id,sequence_no,work_center_id,status,planned_minutes)
 select w.company_id,w.business_unit_id,w.id,r.id,r.sequence_no,r.work_center_id,
        case when r.sequence_no=(select min(x.sequence_no) from public.routing_operations x where x.bom_version_id=w.bom_version_id) then 'ready' else 'pending' end,
        round(r.setup_minutes+(r.run_minutes_per_unit*w.qty),4)
 from public.routing_operations r where r.bom_version_id=w.bom_version_id
 on conflict(work_order_id,sequence_no) do nothing;
 get diagnostics v_ops=row_count;
 update public.work_orders set planned_start_at=coalesce(planned_start_at,now()),planned_end_at=coalesce(planned_end_at,now()+interval '1 day'),updated_by=auth.uid(),updated_at=now() where id=w.id;
 return jsonb_build_object('success',true,'operations_created',v_ops,'material_requirements_created',v_materials);
end $$;

create or replace function public.transition_production_operation(p_operation_id uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.production_operations%rowtype; v_now timestamptz:=now(); v_minutes numeric;
begin
 perform public.assert_module_permission('production','edit');
 select * into o from public.production_operations where id=p_operation_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Production operation not found.'; end if;
 if p_action='start' then
   if o.status not in('ready','paused') then raise exception 'Only ready or paused operations can start.'; end if;
   if exists(select 1 from public.production_operations p where p.work_order_id=o.work_order_id and p.sequence_no<o.sequence_no and p.status<>'completed') then raise exception 'Previous operation must be completed first.'; end if;
   update public.production_operations set status='running',started_at=coalesce(started_at,v_now),updated_at=v_now where id=o.id;
   update public.work_orders set status='in_progress',start_date=coalesce(start_date,current_date),updated_by=auth.uid(),updated_at=v_now where id=o.work_order_id and status='planned';
 elsif p_action='pause' then
   if o.status<>'running' then raise exception 'Only running operations can pause.'; end if;
   update public.production_operations set status='paused',updated_at=v_now where id=o.id;
 elsif p_action='complete' then
   if o.status not in('running','paused') then raise exception 'Only running or paused operations can complete.'; end if;
   v_minutes:=greatest(extract(epoch from (v_now-coalesce(o.started_at,v_now)))/60,0);
   update public.production_operations set status='completed',completed_at=v_now,actual_minutes=round(v_minutes,4),updated_at=v_now where id=o.id;
   update public.production_operations set status='ready',updated_at=v_now where work_order_id=o.work_order_id and sequence_no=(select min(sequence_no) from public.production_operations where work_order_id=o.work_order_id and sequence_no>o.sequence_no and status='pending');
 else raise exception 'Unsupported operation action: %.',p_action; end if;
 return jsonb_build_object('success',true,'action',p_action,'operation_id',o.id);
end $$;

create or replace function public.record_production_output(p_work_order_id uuid,p_operation_id uuid,p_item_id uuid,p_output_type text,p_quantity numeric)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare w public.work_orders%rowtype; o public.production_operations%rowtype; v_id uuid; v_qc uuid; v_no text;
begin
 perform public.assert_module_permission('production','create');
 if p_quantity<=0 then raise exception 'Output quantity must be greater than zero.'; end if;
 if p_output_type not in('finished_good','byproduct','scrap','rework') then raise exception 'Invalid output type.'; end if;
 select * into w from public.work_orders where id=p_work_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Work order not found.'; end if;
 select * into o from public.production_operations where id=p_operation_id and work_order_id=w.id and status in('running','paused','completed');
 if not found then raise exception 'Output requires a started production operation.'; end if;
 if p_output_type='finished_good' and p_item_id<>w.item_id then raise exception 'Finished-good item must match the work order item.'; end if;
 insert into public.production_outputs(company_id,business_unit_id,work_order_id,production_operation_id,item_id,output_type,quantity,accepted_qty,rejected_qty)
 values(w.company_id,w.business_unit_id,w.id,o.id,p_item_id,p_output_type,p_quantity,case when p_output_type='byproduct' then p_quantity else 0 end,case when p_output_type='scrap' then p_quantity else 0 end) returning id into v_id;
 if p_output_type in('finished_good','rework') then
   v_qc:=gen_random_uuid();v_no:='QC-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(v_qc::text,'-',''),1,6));
   insert into public.quality_inspections(id,company_id,business_unit_id,work_order_id,production_output_id,item_id,inspection_no,inspected_qty)
   values(v_qc,w.company_id,w.business_unit_id,w.id,v_id,p_item_id,v_no,p_quantity);
 end if;
 return v_id;
end $$;

create or replace function public.decide_quality_inspection(p_inspection_id uuid,p_decision text,p_accepted_qty numeric,p_rejected_qty numeric,p_disposition text default null,p_remarks text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare q public.quality_inspections%rowtype; v_output public.production_outputs%rowtype;
begin
 perform public.assert_module_permission('production','edit');
 select * into q from public.quality_inspections where id=p_inspection_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Quality inspection not found.'; end if;
 if q.status in('passed','failed','released') then raise exception 'Inspection is already finalized.'; end if;
 if p_accepted_qty<0 or p_rejected_qty<0 or p_accepted_qty+p_rejected_qty>q.inspected_qty then raise exception 'QC quantities exceed inspected quantity.'; end if;
 if p_decision not in('hold','passed','failed','released') then raise exception 'Invalid QC decision.'; end if;
 if p_decision in('passed','released') and p_accepted_qty<=0 then raise exception 'Accepted quantity is required.'; end if;
 if p_decision='failed' and p_rejected_qty<=0 then raise exception 'Rejected quantity is required.'; end if;
 update public.quality_inspections set status=p_decision,accepted_qty=p_accepted_qty,rejected_qty=p_rejected_qty,remarks=nullif(trim(p_remarks),''),inspected_by=auth.uid(),inspected_at=now(),released_by=case when p_decision='released' then auth.uid() else released_by end,released_at=case when p_decision='released' then now() else released_at end,updated_at=now() where id=q.id;
 update public.production_outputs set accepted_qty=p_accepted_qty,rejected_qty=p_rejected_qty where id=q.production_output_id returning * into v_output;
 if p_rejected_qty>0 and p_disposition in('scrap','rework') then
   insert into public.production_outputs(company_id,business_unit_id,work_order_id,production_operation_id,item_id,output_type,quantity,accepted_qty,rejected_qty)
   values(q.company_id,q.business_unit_id,q.work_order_id,v_output.production_operation_id,q.item_id,p_disposition,p_rejected_qty,case when p_disposition='scrap' then 0 else 0 end,case when p_disposition='scrap' then p_rejected_qty else 0 end);
 end if;
 return jsonb_build_object('success',true,'status',p_decision,'accepted_qty',p_accepted_qty,'rejected_qty',p_rejected_qty,'disposition',p_disposition);
end $$;

create or replace function public.transition_maintenance_work_order(p_maintenance_id uuid,p_action text,p_resolution text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m public.maintenance_work_orders%rowtype; a public.maintenance_assets%rowtype; v_down uuid;
begin
 perform public.assert_module_permission('production','edit');
 select * into m from public.maintenance_work_orders where id=p_maintenance_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Maintenance work order not found.'; end if;
 select * into a from public.maintenance_assets where id=m.asset_id for update;
 if p_action='plan' then
   if m.status<>'open' then raise exception 'Only open maintenance can be planned.'; end if;
   update public.maintenance_work_orders set status='planned',planned_at=coalesce(planned_at,now()),updated_at=now() where id=m.id;
 elsif p_action='start' then
   if m.status not in('open','planned') then raise exception 'Only open or planned maintenance can start.'; end if;
   update public.maintenance_work_orders set status='in_progress',started_at=now(),updated_at=now() where id=m.id;
   update public.maintenance_assets set status=case when m.maintenance_type='breakdown' then 'breakdown' else 'maintenance' end,updated_at=now() where id=a.id;
   if not exists(select 1 from public.downtime_events where asset_id=a.id and ended_at is null) then
     insert into public.downtime_events(company_id,business_unit_id,asset_id,work_center_id,reason_code,started_at,notes) values(m.company_id,m.business_unit_id,a.id,a.work_center_id,upper(m.maintenance_type),now(),m.maintenance_no) returning id into v_down;
   end if;
 elsif p_action='complete' then
   if m.status<>'in_progress' then raise exception 'Only in-progress maintenance can complete.'; end if;
   if nullif(trim(p_resolution),'') is null then raise exception 'Resolution is required to complete maintenance.'; end if;
   update public.maintenance_work_orders set status='completed',completed_at=now(),resolution=trim(p_resolution),updated_at=now() where id=m.id;
   update public.maintenance_assets set status='active',updated_at=now() where id=a.id;
   update public.downtime_events set ended_at=now() where asset_id=a.id and ended_at is null;
 else raise exception 'Unsupported maintenance action: %.',p_action; end if;
 return jsonb_build_object('success',true,'action',p_action,'maintenance_id',m.id);
end $$;

revoke all on function public.schedule_work_order(uuid),public.transition_production_operation(uuid,text),public.record_production_output(uuid,uuid,uuid,text,numeric),public.decide_quality_inspection(uuid,text,numeric,numeric,text,text),public.transition_maintenance_work_order(uuid,text,text) from public,anon;
grant execute on function public.schedule_work_order(uuid),public.transition_production_operation(uuid,text),public.record_production_output(uuid,uuid,uuid,text,numeric),public.decide_quality_inspection(uuid,text,numeric,numeric,text,text),public.transition_maintenance_work_order(uuid,text,text) to authenticated;

create or replace view public.production_operations_control with(security_invoker=true) as
select o.id,o.company_id,o.business_unit_id,o.work_order_id,w.order_no,o.sequence_no,o.status,o.planned_minutes,o.actual_minutes,o.started_at,o.completed_at,c.name work_center_name,r.operation_name
from public.production_operations o join public.work_orders w on w.id=o.work_order_id join public.work_centers c on c.id=o.work_center_id left join public.routing_operations r on r.id=o.routing_operation_id;
revoke all on public.production_operations_control from anon; grant select on public.production_operations_control to authenticated;

