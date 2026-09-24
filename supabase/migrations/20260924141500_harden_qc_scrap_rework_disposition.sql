create unique index if not exists production_outputs_qc_disposition_uq on public.production_outputs(work_order_id,production_operation_id,item_id,output_type) where output_type in ('scrap','rework');

create or replace function public.decide_quality_inspection(p_inspection_id uuid,p_decision text,p_accepted_qty numeric,p_rejected_qty numeric,p_disposition text default null,p_remarks text default null)
returns jsonb language plpgsql set search_path='public','pg_temp' as $$
declare q public.quality_inspections%rowtype;v_output public.production_outputs%rowtype;
begin
 perform public.assert_module_permission('production','edit');
 select * into q from public.quality_inspections where id=p_inspection_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Quality inspection not found.'; end if;
 if q.status in('passed','failed','released') then raise exception 'Inspection is already finalized.'; end if;
 if p_accepted_qty<0 or p_rejected_qty<0 or p_accepted_qty+p_rejected_qty<>q.inspected_qty then raise exception 'Accepted plus rejected quantity must equal inspected quantity.'; end if;
 if p_decision not in('hold','passed','failed','released') then raise exception 'Invalid QC decision.'; end if;
 if p_decision in('passed','released') and p_accepted_qty<=0 then raise exception 'Accepted quantity is required.'; end if;
 if p_decision='failed' and p_rejected_qty<=0 then raise exception 'Rejected quantity is required.'; end if;
 if p_rejected_qty>0 and p_disposition not in('scrap','rework') then raise exception 'Scrap or rework disposition is required for rejected quantity.'; end if;
 if p_rejected_qty=0 and p_disposition is not null then raise exception 'Disposition is only valid for rejected quantity.'; end if;
 update public.quality_inspections set status=p_decision,accepted_qty=p_accepted_qty,rejected_qty=p_rejected_qty,remarks=nullif(trim(p_remarks),''),inspected_by=auth.uid(),inspected_at=now(),released_by=case when p_decision='released' then auth.uid() else released_by end,released_at=case when p_decision='released' then now() else released_at end,updated_at=now() where id=q.id;
 update public.production_outputs set accepted_qty=p_accepted_qty,rejected_qty=p_rejected_qty where id=q.production_output_id returning * into v_output;
 if p_rejected_qty>0 then
   insert into public.production_outputs(company_id,business_unit_id,work_order_id,production_operation_id,item_id,output_type,quantity,accepted_qty,rejected_qty)
   values(q.company_id,q.business_unit_id,q.work_order_id,v_output.production_operation_id,q.item_id,p_disposition,p_rejected_qty,0,case when p_disposition='scrap' then p_rejected_qty else 0 end)
   on conflict (work_order_id,production_operation_id,item_id,output_type) where output_type in ('scrap','rework')
   do update set quantity=excluded.quantity,accepted_qty=excluded.accepted_qty,rejected_qty=excluded.rejected_qty;
 end if;
 return jsonb_build_object('success',true,'status',p_decision,'accepted_qty',p_accepted_qty,'rejected_qty',p_rejected_qty,'disposition',p_disposition);
end $$;