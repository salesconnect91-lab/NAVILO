insert into public.inventory_posting_settings(company_id,business_unit_id,inventory_account_id)
select bu.company_id,bu.id,am.account_id
from public.business_units bu
left join public.account_mappings am on am.company_id=bu.company_id and am.mapping_key='inventory'
where bu.is_active=true
on conflict(company_id,business_unit_id) do update
set inventory_account_id=coalesce(public.inventory_posting_settings.inventory_account_id,excluded.inventory_account_id),updated_at=now();
