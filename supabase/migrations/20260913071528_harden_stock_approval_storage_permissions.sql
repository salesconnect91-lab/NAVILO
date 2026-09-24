drop policy if exists stock_adjustment_approvals_select_company on storage.objects;
drop policy if exists stock_adjustment_approvals_insert_company on storage.objects;
drop policy if exists stock_adjustment_approvals_delete_own on storage.objects;
drop policy if exists stock_transfer_approvals_select_company on storage.objects;
drop policy if exists stock_transfer_approvals_insert_company on storage.objects;
drop policy if exists stock_transfer_approvals_delete_own on storage.objects;

create policy stock_adjustment_approvals_select_company on storage.objects
for select to authenticated
using (bucket_id='stock-adjustment-approvals' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_module_permission((select public.current_company_id()),'inventory','view'));
create policy stock_adjustment_approvals_insert_company on storage.objects
for insert to authenticated
with check (bucket_id='stock-adjustment-approvals' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_module_permission((select public.current_company_id()),'inventory','edit'));
create policy stock_adjustment_approvals_delete_own on storage.objects
for delete to authenticated
using (bucket_id='stock-adjustment-approvals' and owner_id=(auth.uid())::text and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_module_permission((select public.current_company_id()),'inventory','edit'));

create policy stock_transfer_approvals_select_company on storage.objects
for select to authenticated
using (bucket_id='stock-transfer-approvals' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_module_permission((select public.current_company_id()),'inventory','view'));
create policy stock_transfer_approvals_insert_company on storage.objects
for insert to authenticated
with check (bucket_id='stock-transfer-approvals' and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_module_permission((select public.current_company_id()),'inventory','edit'));
create policy stock_transfer_approvals_delete_own on storage.objects
for delete to authenticated
using (bucket_id='stock-transfer-approvals' and owner_id=(auth.uid())::text and (storage.foldername(name))[1]=(select public.current_company_id())::text and public.has_module_permission((select public.current_company_id()),'inventory','edit'));
