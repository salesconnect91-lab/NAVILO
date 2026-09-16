-- Activate tenant-scoped manufacturing accounting without weakening company or BU isolation.

create or replace function public.process_inventory_accounting_queue(
  p_queue_id uuid,
  p_post boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  q public.inventory_accounting_queue%rowtype;
  v_entry_id uuid;
  v_post_result jsonb;
begin
  perform public.assert_module_permission('accounting','create');

  select * into q
  from public.inventory_accounting_queue
  where id=p_queue_id
    and company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
  for update;

  if not found then raise exception 'Accounting queue item not found in the active business unit.'; end if;
  if q.status='pending_mapping' then raise exception 'Configure Inventory and WIP accounts before journal creation.'; end if;
  if q.status='cancelled' then raise exception 'Cancelled queue items cannot be processed.'; end if;
  if q.status='posted' then
    return jsonb_build_object('success',true,'status','posted','journal_entry_id',q.journal_entry_id,'already_processed',true);
  end if;

  if q.status='ready' then
    v_entry_id:=public.create_inventory_accounting_journal(q.id);
  elsif q.status='journal_created' and q.journal_entry_id is not null then
    v_entry_id:=q.journal_entry_id;
  else
    raise exception 'Queue item is not processable. Current status: %.',q.status;
  end if;

  if p_post then
    perform public.assert_module_permission('accounting','post');
    v_post_result:=public.post_journal_entry(v_entry_id);
    update public.inventory_accounting_queue
      set status='posted',updated_at=now(),notes=null
      where id=q.id;
    return jsonb_build_object('success',true,'status','posted','journal_entry_id',v_entry_id,'posting',v_post_result);
  end if;

  return jsonb_build_object('success',true,'status','journal_created','journal_entry_id',v_entry_id);
end $$;

revoke all on function public.process_inventory_accounting_queue(uuid,boolean) from public,anon;
grant execute on function public.process_inventory_accounting_queue(uuid,boolean) to authenticated;

-- Existing customer activation. Future companies select their own accounts in the UI.
select set_config('app.maintenance_reset','1',true);

with target as (
  select c.id company_id,
         coalesce((select am.user_id from public.account_mappings am where am.company_id=c.id limit 1),c.created_by) user_id,
         (select id from public.chart_of_accounts where company_id=c.id and code='1100' and is_group=true limit 1) current_assets_id,
         (select id from public.chart_of_accounts where company_id=c.id and code='5000' and is_group=true limit 1) cost_of_sales_id
  from public.companies c where c.name='AMK Steels Private Limited'
), account_seed(code,name,type,detail_type,normal_balance,parent_kind,description) as (
  values
   ('1141','Work in Progress Inventory','asset','Work in Progress','debit','current_assets','Production costs accumulated before finished-goods receipt.'),
   ('5110','Manufacturing Variance','expense','Manufacturing Variance','debit','cost_of_sales','Actual-versus-standard manufacturing cost variance.'),
   ('5120','Scrap and Yield Loss','expense','Scrap and Yield Loss','debit','cost_of_sales','Approved manufacturing scrap and yield loss.')
)
insert into public.chart_of_accounts(
 user_id,company_id,code,name,type,account_role,detail_type,parent_id,parent_head,is_group,
 normal_balance,allow_manual_entries,is_system_account,is_active,description
)
select t.user_id,t.company_id,s.code,s.name,s.type,'system',s.detail_type,
 case s.parent_kind when 'current_assets' then t.current_assets_id else t.cost_of_sales_id end,
 case s.parent_kind when 'current_assets' then 'Current Assets' else 'Cost of Sales' end,
 false,s.normal_balance,true,true,true,s.description
from target t cross join account_seed s
where t.user_id is not null
  and not exists(select 1 from public.chart_of_accounts x where x.company_id=t.company_id and x.code=s.code);

update public.inventory_posting_settings s
set inventory_account_id=coalesce(s.inventory_account_id,m_inventory.account_id),
    wip_account_id=a_wip.id,
    production_variance_account_id=a_variance.id,
    scrap_account_id=a_scrap.id,
    updated_at=now()
from public.companies c
left join public.account_mappings m_inventory on m_inventory.company_id=c.id and m_inventory.mapping_key='inventory'
join public.chart_of_accounts a_wip on a_wip.company_id=c.id and a_wip.code='1141'
join public.chart_of_accounts a_variance on a_variance.company_id=c.id and a_variance.code='5110'
join public.chart_of_accounts a_scrap on a_scrap.company_id=c.id and a_scrap.code='5120'
where c.name='AMK Steels Private Limited' and s.company_id=c.id;

update public.inventory_accounting_queue q
set debit_account_id=case q.queue_type
      when 'material_issue' then s.wip_account_id
      when 'material_return' then s.inventory_account_id
      when 'finished_goods_receipt' then s.inventory_account_id
      when 'production_variance' then s.production_variance_account_id
      when 'scrap' then s.scrap_account_id end,
    credit_account_id=case q.queue_type
      when 'material_issue' then s.inventory_account_id
      when 'material_return' then s.wip_account_id
      when 'finished_goods_receipt' then s.wip_account_id
      when 'production_variance' then s.wip_account_id
      when 'scrap' then s.wip_account_id end,
    status='ready',notes=null,updated_at=now()
from public.inventory_posting_settings s
where q.company_id=s.company_id and q.business_unit_id=s.business_unit_id
  and q.status='pending_mapping'
  and s.inventory_account_id is not null and s.wip_account_id is not null
  and (q.queue_type not in('production_variance','scrap')
       or (q.queue_type='production_variance' and s.production_variance_account_id is not null)
       or (q.queue_type='scrap' and s.scrap_account_id is not null));

select set_config('app.maintenance_reset','0',true);
