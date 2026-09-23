drop policy if exists stock_transfer_approvals_select_company on storage.objects;
create policy stock_transfer_approvals_select_company on storage.objects
for select to authenticated
using (
  bucket_id='stock-transfer-approvals'
  and (storage.foldername(name))[1]=(select public.current_company_id())::text
  and public.has_module_permission((select public.current_company_id()),'inventory','view')
  and exists (
    select 1 from public.stock_movements sm
    where sm.company_id=(select public.current_company_id())
      and sm.business_unit_id=(select public.current_business_unit_id())
      and sm.approval_slip_path=storage.objects.name
      and sm.source_type='warehouse_transfer'
  )
);

create or replace function public.validate_stock_movement_approval_evidence()
returns trigger
language plpgsql
security definer
set search_path to 'public','storage','pg_temp'
as $function$
declare v_bucket text;
begin
  if new.source_type not in ('manual_adjustment','warehouse_transfer') then return new; end if;
  if nullif(btrim(coalesce(new.approval_slip_path,'')),'') is null then
    raise exception 'Approval evidence is required for controlled stock adjustments and transfers.';
  end if;
  if split_part(new.approval_slip_path,'/',1)<>new.company_id::text then
    raise exception 'Stock approval evidence does not belong to the movement company.';
  end if;
  v_bucket:=case when new.source_type='manual_adjustment' then 'stock-adjustment-approvals' else 'stock-transfer-approvals' end;
  if not exists(select 1 from storage.objects o where o.bucket_id=v_bucket and o.name=new.approval_slip_path) then
    raise exception 'Stock approval evidence file is missing.';
  end if;
  return new;
end
$function$;
revoke all on function public.validate_stock_movement_approval_evidence() from public,anon,authenticated;
drop trigger if exists zz_validate_stock_movement_approval_evidence on public.stock_movements;
create trigger zz_validate_stock_movement_approval_evidence
before insert on public.stock_movements
for each row execute function public.validate_stock_movement_approval_evidence();
