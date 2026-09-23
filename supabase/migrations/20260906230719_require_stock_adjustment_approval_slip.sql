insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('stock-adjustment-approvals','stock-adjustment-approvals',false,5242880,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists stock_adjustment_approvals_insert_company on storage.objects;
create policy stock_adjustment_approvals_insert_company on storage.objects for insert to authenticated
with check(bucket_id='stock-adjustment-approvals' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists stock_adjustment_approvals_select_company on storage.objects;
create policy stock_adjustment_approvals_select_company on storage.objects for select to authenticated
using(bucket_id='stock-adjustment-approvals' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists stock_adjustment_approvals_delete_own on storage.objects;
create policy stock_adjustment_approvals_delete_own on storage.objects for delete to authenticated
using(bucket_id='stock-adjustment-approvals' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=public.current_company_id()::text);

drop function if exists public.manual_stock_adjustment(uuid,uuid,uuid,text,numeric,text,text,uuid,text);

create function public.manual_stock_adjustment(
 p_item_id uuid,p_warehouse_id uuid,p_godown_id uuid,p_action text,p_qty numeric,p_reason_code text,p_reference text,p_approved_by_employee_id uuid,p_approval_slip_path text,p_remarks text default null
) returns numeric
language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare
 v_user_id uuid:=public.legacy_data_user_id(); v_company_id uuid:=public.current_company_id(); v_unit_id uuid:=public.current_business_unit_id();
 v_stock_id uuid; v_godown_name text; v_current numeric:=0; v_new numeric; v_approver_name text; v_reason text; v_entered text;
begin
 perform public.assert_module_permission('inventory','edit');
 if v_user_id is null or v_company_id is null or v_unit_id is null then raise exception 'Authentication, active company and business unit are required.'; end if;
 if p_action not in ('add','remove') then raise exception 'Adjustment type must be Add or Remove.'; end if;
 if p_qty is null or p_qty<=0 then raise exception 'Adjustment quantity must be greater than zero.'; end if;
 if p_reason_code not in ('physical_count_difference','shortage','excess_found','damage','breakage','scrap_wastage','weight_difference','loading_unloading_difference','wrong_entry_correction','opening_stock_correction','other') then raise exception 'Select a valid adjustment reason.'; end if;
 if nullif(btrim(coalesce(p_reference,'')),'') is null then raise exception 'Reference / approval document number is required.'; end if;
 if p_approved_by_employee_id is null then raise exception 'Approved By is required.'; end if;
 if nullif(btrim(coalesce(p_approval_slip_path,'')),'') is null then raise exception 'Approved stock adjustment slip upload is required.'; end if;
 if split_part(p_approval_slip_path,'/',1)<>v_company_id::text then raise exception 'Approval slip does not belong to active company.'; end if;
 if p_reason_code='other' and nullif(btrim(coalesce(p_remarks,'')),'') is null then raise exception 'Remarks are required when reason is Other.'; end if;
 if not exists(select 1 from public.items where id=p_item_id and company_id=v_company_id) then raise exception 'Selected item does not belong to active company.'; end if;
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and company_id=v_company_id) then raise exception 'Selected warehouse does not belong to active company.'; end if;
 select name into v_godown_name from public.godowns where id=p_godown_id and warehouse_id=p_warehouse_id and company_id=v_company_id;
 if v_godown_name is null then raise exception 'Selected godown does not belong to active company/warehouse.'; end if;
 select name into v_approver_name from public.employees where id=p_approved_by_employee_id and company_id=v_company_id and is_active=true;
 if v_approver_name is null then raise exception 'Selected approver is invalid or inactive.'; end if;
 v_reason:=case p_reason_code when 'physical_count_difference' then 'Physical Count Difference' when 'shortage' then 'Shortage' when 'excess_found' then 'Excess Found' when 'damage' then 'Damage' when 'breakage' then 'Breakage' when 'scrap_wastage' then 'Scrap / Wastage' when 'weight_difference' then 'Weight Difference' when 'loading_unloading_difference' then 'Loading / Unloading Difference' when 'wrong_entry_correction' then 'Wrong Previous Entry Correction' when 'opening_stock_correction' then 'Opening Stock Correction' else 'Other' end;
 v_entered:=coalesce(nullif(auth.jwt()->>'email',''),auth.uid()::text);
 perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':'||v_unit_id::text||':'||p_item_id::text||':'||p_warehouse_id::text||':'||p_godown_id::text,0));
 select id,coalesce(quantity,0) into v_stock_id,v_current from public.warehouse_stock where user_id=v_user_id and company_id=v_company_id and business_unit_id=v_unit_id and item_id=p_item_id and warehouse_id=p_warehouse_id and godown_id=p_godown_id limit 1 for update;
 v_current:=coalesce(v_current,0);
 if p_action='remove' and p_qty>v_current then raise exception 'Insufficient stock. Available: %, Remove requested: %.',v_current,p_qty; end if;
 v_new:=case when p_action='add' then v_current+p_qty else v_current-p_qty end;
 if v_stock_id is null then insert into public.warehouse_stock(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,quantity,updated_at) values(v_user_id,v_company_id,v_unit_id,p_item_id,p_warehouse_id,p_godown_id,v_godown_name,v_new,now()); else update public.warehouse_stock set quantity=v_new,godown=v_godown_name,updated_at=now() where id=v_stock_id and business_unit_id=v_unit_id; end if;
 insert into public.stock_movements(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,type,qty,reference,reason,remarks,source_type,created_by,adjustment_action,reason_code,approved_by_employee_id,approved_by_name,entered_by_name,previous_qty,resulting_qty,approval_slip_path)
 values(v_user_id,v_company_id,v_unit_id,p_item_id,p_warehouse_id,p_godown_id,v_godown_name,'adjust',p_qty,btrim(p_reference),v_reason,nullif(btrim(coalesce(p_remarks,'')),''),'manual_adjustment',auth.uid(),p_action,p_reason_code,p_approved_by_employee_id,v_approver_name,v_entered,v_current,v_new,btrim(p_approval_slip_path));
 return v_new;
end;
$function$;
grant execute on function public.manual_stock_adjustment(uuid,uuid,uuid,text,numeric,text,text,uuid,text,text) to authenticated;
revoke execute on function public.manual_stock_adjustment(uuid,uuid,uuid,text,numeric,text,text,uuid,text,text) from anon;
