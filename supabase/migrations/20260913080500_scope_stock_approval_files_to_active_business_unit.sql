-- Approval evidence must follow the stock movement's active BU, not merely the company folder.
drop policy if exists stock_adjustment_approvals_select_company on storage.objects;
drop policy if exists stock_transfer_approvals_select_company on storage.objects;

create policy stock_adjustment_approvals_select_company on storage.objects
for select to authenticated
using (
  bucket_id='stock-adjustment-approvals'
  and (storage.foldername(name))[1]=(select public.current_company_id())::text
  and public.has_module_permission((select public.current_company_id()),'inventory','view')
  and exists (
    select 1 from public.stock_movements sm
    where sm.company_id=(select public.current_company_id())
      and sm.business_unit_id=(select public.current_business_unit_id())
      and sm.approval_slip_path=storage.objects.name
      and sm.source_type='manual_adjustment'
  )
);

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
      and sm.source_type='stock_transfer'
  )
);
