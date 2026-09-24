alter table public.stock_movements add column if not exists approval_slip_path text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('stock-transfer-approvals','stock-transfer-approvals',false,5242880,array['application/pdf','image/png','image/jpeg','image/webp']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists stock_transfer_approvals_select_company on storage.objects;
create policy stock_transfer_approvals_select_company on storage.objects for select to authenticated
using (bucket_id='stock-transfer-approvals' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists stock_transfer_approvals_insert_company on storage.objects;
create policy stock_transfer_approvals_insert_company on storage.objects for insert to authenticated
with check (bucket_id='stock-transfer-approvals' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists stock_transfer_approvals_delete_own on storage.objects;
create policy stock_transfer_approvals_delete_own on storage.objects for delete to authenticated
using (bucket_id='stock-transfer-approvals' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=public.current_company_id()::text);

create or replace function public.transfer_stock_controlled(
 p_item_id uuid,
 p_warehouse_id uuid,
 p_from_godown_id uuid,
 p_to_godown_id uuid,
 p_qty numeric,
 p_reason_code text,
 p_reason text,
 p_reference text,
 p_approved_by_employee_id uuid,
 p_approval_slip_path text,
 p_remarks text default null
) returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
 v_user_id uuid:=public.legacy_data_user_id();
 v_company_id uuid:=public.current_company_id();
 v_unit_id uuid:=public.current_business_unit_id();
 v_from_stock_id uuid; v_to_stock_id uuid; v_from_qty numeric:=0; v_to_qty numeric:=0;
 v_from_name text; v_to_name text; v_approver text; v_entered_by text;
 v_reason_code text:=lower(btrim(coalesce(p_reason_code,'')));
 v_reason text:=btrim(coalesce(p_reason,''));
 v_reference text:=btrim(coalesce(p_reference,''));
 v_slip text:=btrim(coalesce(p_approval_slip_path,''));
begin
 perform public.assert_module_permission('inventory','edit');
 if v_user_id is null or v_company_id is null or v_unit_id is null then raise exception 'Authentication, active company and business unit are required.'; end if;
 if p_item_id is null or p_warehouse_id is null or p_from_godown_id is null or p_to_godown_id is null then raise exception 'Item, warehouse and both godowns are required.'; end if;
 if p_from_godown_id=p_to_godown_id then raise exception 'Source and destination godown cannot be the same.'; end if;
 if p_qty is null or p_qty<=0 then raise exception 'Transfer quantity must be greater than zero.'; end if;
 if v_reason_code not in ('routine_transfer','stock_rebalancing','dispatch_preparation','production_requirement','space_capacity','quality_segregation','inspection_hold','other') then raise exception 'Select a valid transfer reason.'; end if;
 if v_reason='' then raise exception 'Transfer reason is required.'; end if;
 if v_reason_code='other' and nullif(btrim(coalesce(p_remarks,'')),'') is null then raise exception 'Remarks are required when reason is Other.'; end if;
 if v_reference='' then raise exception 'Transfer reference / approval number is required.'; end if;
 if p_approved_by_employee_id is null then raise exception 'Godown manager approval is required.'; end if;
 if v_slip='' then raise exception 'Approved transfer slip upload is required.'; end if;
 if split_part(v_slip,'/',1)<>v_company_id::text then raise exception 'Approval slip does not belong to active company.'; end if;
 if not exists(select 1 from storage.objects where bucket_id='stock-transfer-approvals' and name=v_slip) then raise exception 'Approval slip was not found. Upload the approved slip before transfer.'; end if;
 if not exists(select 1 from public.items where id=p_item_id and company_id=v_company_id) then raise exception 'Selected item does not belong to active company.'; end if;
 select name into v_from_name from public.godowns where id=p_from_godown_id and warehouse_id=p_warehouse_id and company_id=v_company_id;
 select name into v_to_name from public.godowns where id=p_to_godown_id and warehouse_id=p_warehouse_id and company_id=v_company_id;
 if v_from_name is null or v_to_name is null then raise exception 'Source/destination godown does not belong to active company/warehouse.'; end if;
 select name into v_approver from public.employees where id=p_approved_by_employee_id and company_id=v_company_id and is_active=true;
 if v_approver is null then raise exception 'Selected approver is not an active employee of this company.'; end if;
 select coalesce((select e.name from public.employees e where e.company_id=v_company_id and e.user_id=auth.uid() and e.is_active=true limit 1),auth.jwt()->>'email',auth.uid()::text) into v_entered_by;

 perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':'||v_unit_id::text||':'||p_item_id::text||':'||p_warehouse_id::text,0));
 select id,coalesce(quantity,0) into v_from_stock_id,v_from_qty from public.warehouse_stock
 where company_id=v_company_id and business_unit_id=v_unit_id and item_id=p_item_id and warehouse_id=p_warehouse_id and godown_id=p_from_godown_id limit 1 for update;
 if v_from_stock_id is null or p_qty>coalesce(v_from_qty,0) then raise exception 'Insufficient stock. Available in %: %, Required: %.',v_from_name,coalesce(v_from_qty,0),p_qty; end if;
 select id,coalesce(quantity,0) into v_to_stock_id,v_to_qty from public.warehouse_stock
 where company_id=v_company_id and business_unit_id=v_unit_id and item_id=p_item_id and warehouse_id=p_warehouse_id and godown_id=p_to_godown_id limit 1 for update;
 v_to_qty:=coalesce(v_to_qty,0);

 update public.warehouse_stock set quantity=v_from_qty-p_qty,updated_at=now(),godown=v_from_name where id=v_from_stock_id and business_unit_id=v_unit_id;
 if v_to_stock_id is null then
   insert into public.warehouse_stock(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,quantity,updated_at)
   values(v_user_id,v_company_id,v_unit_id,p_item_id,p_warehouse_id,p_to_godown_id,v_to_name,p_qty,now());
 else
   update public.warehouse_stock set quantity=v_to_qty+p_qty,updated_at=now(),godown=v_to_name where id=v_to_stock_id and business_unit_id=v_unit_id;
 end if;

 insert into public.stock_movements(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,type,qty,reference,reason_code,reason,remarks,approved_by_employee_id,approved_by_name,entered_by_name,approval_slip_path,source_type,previous_qty,resulting_qty,adjustment_action,created_by)
 values
 (v_user_id,v_company_id,v_unit_id,p_item_id,p_warehouse_id,p_from_godown_id,v_from_name,'out',p_qty,v_reference,v_reason_code,v_reason,nullif(btrim(coalesce(p_remarks,'')),''),p_approved_by_employee_id,v_approver,v_entered_by,v_slip,'godown_transfer',v_from_qty,v_from_qty-p_qty,'transfer_out',auth.uid()),
 (v_user_id,v_company_id,v_unit_id,p_item_id,p_warehouse_id,p_to_godown_id,v_to_name,'in',p_qty,v_reference,v_reason_code,v_reason,nullif(btrim(coalesce(p_remarks,'')),''),p_approved_by_employee_id,v_approver,v_entered_by,v_slip,'godown_transfer',v_to_qty,v_to_qty+p_qty,'transfer_in',auth.uid());
end;
$function$;

revoke execute on function public.transfer_stock_v2(uuid,uuid,uuid,uuid,numeric,text) from authenticated, anon;
grant execute on function public.transfer_stock_controlled(uuid,uuid,uuid,uuid,numeric,text,text,text,uuid,text,text) to authenticated;
