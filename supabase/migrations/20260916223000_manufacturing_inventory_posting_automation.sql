-- Transactional, idempotent bridge between manufacturing documents, stock and accounting review.

create table if not exists public.inventory_posting_settings(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete cascade,
 valuation_method text not null default 'weighted_average' check(valuation_method in('fifo','weighted_average')),
 inventory_account_id uuid references public.chart_of_accounts(id) on delete restrict,
 wip_account_id uuid references public.chart_of_accounts(id) on delete restrict,
 production_variance_account_id uuid references public.chart_of_accounts(id) on delete restrict,
 scrap_account_id uuid references public.chart_of_accounts(id) on delete restrict,
 auto_create_accounting_queue boolean not null default true, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,business_unit_id)
);

create table if not exists public.inventory_posting_events(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete cascade,
 document_id uuid not null references public.inventory_control_documents(id) on delete restrict,
 event_type text not null check(event_type in('post','dispatch','receipt','reverse')),
 stock_movement_count integer not null default 0, total_cost numeric(18,4) not null default 0,
 posted_by uuid not null default auth.uid(), posted_at timestamptz not null default now(),
 reversal_of_event_id uuid references public.inventory_posting_events(id) on delete restrict,
 unique(document_id,event_type)
);

create table if not exists public.inventory_cost_consumptions(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete cascade,
 posting_event_id uuid not null references public.inventory_posting_events(id) on delete cascade,
 document_line_id uuid not null references public.inventory_control_document_lines(id) on delete restrict,
 valuation_layer_id uuid references public.inventory_valuation_layers(id) on delete restrict,
 quantity numeric(18,4) not null check(quantity>0), unit_cost numeric(18,4) not null check(unit_cost>=0),
 total_cost numeric(18,4) generated always as (quantity*unit_cost) stored
);

create table if not exists public.inventory_accounting_queue(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 business_unit_id uuid not null references public.business_units(id) on delete cascade,
 posting_event_id uuid not null unique references public.inventory_posting_events(id) on delete restrict,
 document_id uuid not null references public.inventory_control_documents(id) on delete restrict,
 queue_type text not null check(queue_type in('material_issue','material_return','finished_goods_receipt','production_variance','scrap')),
 amount numeric(18,4) not null check(amount>=0), debit_account_id uuid references public.chart_of_accounts(id) on delete restrict,
 credit_account_id uuid references public.chart_of_accounts(id) on delete restrict,
 status text not null default 'pending_mapping' check(status in('pending_mapping','ready','journal_created','posted','cancelled')),
 journal_entry_id uuid references public.journal_entries(id) on delete restrict, notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

do $$ declare t text; begin foreach t in array array['inventory_posting_settings','inventory_posting_events','inventory_cost_consumptions','inventory_accounting_queue'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy %I on public.%I for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,''inventory'',''view'') or public.has_module_permission(company_id,''accounting'',''view'')))','posting_read_'||t,t);
 execute format('create policy %I on public.%I for insert to authenticated with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''inventory'',''post''))','posting_create_'||t,t);
 execute format('create policy %I on public.%I for update to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,''inventory'',''post'') or public.has_module_permission(company_id,''accounting'',''post''))) with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (public.has_module_permission(company_id,''inventory'',''post'') or public.has_module_permission(company_id,''accounting'',''post'')))','posting_edit_'||t,t);
 execute format('revoke all on public.%I from anon',t);
 execute format('grant select,insert,update on public.%I to authenticated',t);
end loop; end $$;

create or replace function public.generate_work_order_material_requirements(p_work_order_id uuid)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_order public.work_orders%rowtype; v_count integer;
begin
 perform public.assert_module_permission('production','edit');
 select * into v_order from public.work_orders where id=p_work_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Work order not found in active business unit.'; end if;
 if v_order.bom_version_id is null then raise exception 'Approved BOM version is required.'; end if;
 if not exists(select 1 from public.bom_versions b where b.id=v_order.bom_version_id and b.status='approved' and b.company_id=v_order.company_id and b.business_unit_id=v_order.business_unit_id) then raise exception 'Work order BOM is not approved.'; end if;
 insert into public.production_material_requirements(company_id,business_unit_id,work_order_id,bom_line_id,item_id,required_qty,warehouse_id,required_at,status)
 select v_order.company_id,v_order.business_unit_id,v_order.id,bl.id,bl.item_id,round((bl.quantity*(1+bl.scrap_pct/100))*v_order.qty/b.output_qty,4),v_order.warehouse_id,v_order.planned_start_at,'planned'
 from public.bom_lines bl join public.bom_versions b on b.id=bl.bom_version_id
 where bl.bom_version_id=v_order.bom_version_id and bl.line_type='component'
 on conflict do nothing;
 get diagnostics v_count=row_count; return v_count;
end $$;

create unique index if not exists uq_material_requirement_bom_line on public.production_material_requirements(work_order_id,bom_line_id) where bom_line_id is not null;

create or replace function public.reserve_work_order_materials(p_work_order_id uuid,p_warehouse_id uuid,p_godown_id uuid)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare r record; v_available numeric; v_count integer:=0; v_need numeric;
begin
 perform public.assert_module_permission('inventory','post');
 perform pg_advisory_xact_lock(hashtextextended(public.current_company_id()::text||':'||public.current_business_unit_id()::text||':'||p_work_order_id::text,0));
 for r in select * from public.production_material_requirements where work_order_id=p_work_order_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and status not in('issued','cancelled') order by item_id for update loop
   v_need:=greatest(r.required_qty-r.reserved_qty,0); if v_need=0 then continue; end if;
   select coalesce(ws.quantity,0)-coalesce((select sum(sr.reserved_qty-sr.consumed_qty) from public.stock_reservations sr where sr.company_id=r.company_id and sr.business_unit_id=r.business_unit_id and sr.item_id=r.item_id and sr.warehouse_id=p_warehouse_id and sr.godown_id=p_godown_id and sr.status in('active','part_consumed')),0)
   into v_available from public.warehouse_stock ws where ws.company_id=r.company_id and ws.business_unit_id=r.business_unit_id and ws.item_id=r.item_id and ws.warehouse_id=p_warehouse_id and ws.godown_id=p_godown_id for update;
   if coalesce(v_available,0)<v_need then raise exception 'Insufficient available stock for item %. Available %, required %.',r.item_id,coalesce(v_available,0),v_need; end if;
   insert into public.stock_reservations(company_id,business_unit_id,item_id,warehouse_id,godown_id,source_type,source_id,reserved_qty,required_at)
   values(r.company_id,r.business_unit_id,r.item_id,p_warehouse_id,p_godown_id,'work_order',p_work_order_id,v_need,r.required_at);
   update public.production_material_requirements set reserved_qty=reserved_qty+v_need,status=case when reserved_qty+v_need>=required_qty then 'reserved' else 'planned' end,warehouse_id=p_warehouse_id,updated_at=now() where id=r.id;
   v_count:=v_count+1;
 end loop; return v_count;
end $$;

create or replace function public.post_inventory_control_document(p_document_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.inventory_control_documents%rowtype; l record; s public.inventory_posting_settings%rowtype;
 v_event_type text; v_event_id uuid; v_qty numeric; v_prev numeric; v_godown text; v_cost numeric; v_total numeric:=0; v_count integer:=0;
 v_stock_id uuid; v_layer record; v_take numeric; v_remaining numeric; v_debit uuid; v_credit uuid; v_queue_status text;
begin
 perform public.assert_module_permission('inventory','post');
 select * into d from public.inventory_control_documents where id=p_document_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Inventory document not found in active business unit.'; end if;
 if d.document_type='transfer' and d.status='approved' then v_event_type:='dispatch';
 elsif d.document_type='transfer' and d.status='in_transit' then v_event_type:='receipt';
 elsif d.status='approved' then v_event_type:='post';
 else raise exception 'Document must be approved, or in transit for receipt. Current status: %.',d.status; end if;
 if exists(select 1 from public.inventory_posting_events where document_id=d.id and event_type=v_event_type) then raise exception 'This document event is already posted.'; end if;
 if not exists(select 1 from public.inventory_control_document_lines where document_id=d.id) then raise exception 'Document has no lines.'; end if;
 select * into s from public.inventory_posting_settings where company_id=d.company_id and business_unit_id=d.business_unit_id and is_active=true;
 insert into public.inventory_posting_events(company_id,business_unit_id,document_id,event_type) values(d.company_id,d.business_unit_id,d.id,v_event_type) returning id into v_event_id;
 perform pg_advisory_xact_lock(hashtextextended(d.company_id::text||':'||d.business_unit_id::text||':'||d.id::text,0));
 for l in select dl.*,coalesce(dl.unit_cost,i.cost,0) fallback_cost from public.inventory_control_document_lines dl join public.items i on i.id=dl.item_id where dl.document_id=d.id order by dl.line_no loop
   v_qty:=l.quantity; v_cost:=l.fallback_cost;
   if (d.document_type='material_issue') or (d.document_type='transfer' and v_event_type='dispatch') then
     select id,quantity into v_stock_id,v_prev from public.warehouse_stock where company_id=d.company_id and business_unit_id=d.business_unit_id and item_id=l.item_id and warehouse_id=d.from_warehouse_id and godown_id=d.from_godown_id for update;
     if v_stock_id is null or v_prev<v_qty then raise exception 'Insufficient stock for item %. Available %, required %.',l.item_id,coalesce(v_prev,0),v_qty; end if;
     if coalesce(s.valuation_method,'weighted_average')='fifo' then
       v_remaining:=v_qty; v_cost:=0;
       for v_layer in select * from public.inventory_valuation_layers where company_id=d.company_id and business_unit_id=d.business_unit_id and item_id=l.item_id and warehouse_id=d.from_warehouse_id and godown_id=d.from_godown_id and remaining_qty>0 order by received_at,id for update loop
         exit when v_remaining<=0; v_take:=least(v_remaining,v_layer.remaining_qty);
         update public.inventory_valuation_layers set remaining_qty=remaining_qty-v_take where id=v_layer.id;
         insert into public.inventory_cost_consumptions(company_id,business_unit_id,posting_event_id,document_line_id,valuation_layer_id,quantity,unit_cost) values(d.company_id,d.business_unit_id,v_event_id,l.id,v_layer.id,v_take,v_layer.unit_cost);
         v_cost:=v_cost+(v_take*v_layer.unit_cost); v_remaining:=v_remaining-v_take;
       end loop;
       if v_remaining>0 then raise exception 'FIFO valuation layers are insufficient for item %.',l.item_id; end if;
       v_cost:=case when v_qty=0 then 0 else v_cost/v_qty end;
     end if;
     update public.warehouse_stock set quantity=v_prev-v_qty,updated_at=now() where id=v_stock_id;
     select name into v_godown from public.godowns where id=d.from_godown_id;
     insert into public.stock_movements(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,type,qty,reference,unit_cost,source_type,source_id,previous_qty,resulting_qty,adjustment_action,lot_id,bin_id,inventory_document_id,created_by)
     values(public.legacy_data_user_id(),d.company_id,d.business_unit_id,l.item_id,d.from_warehouse_id,d.from_godown_id,v_godown,'out',v_qty,d.document_no,v_cost,d.document_type,d.id,v_prev,v_prev-v_qty,case when d.document_type='transfer' then 'transfer_dispatch' else 'material_issue' end,l.lot_id,l.from_bin_id,d.id,auth.uid());
     if d.document_type='material_issue' then
       update public.stock_reservations set consumed_qty=least(reserved_qty,consumed_qty+v_qty),status=case when consumed_qty+v_qty>=reserved_qty then 'consumed' else 'part_consumed' end,updated_at=now()
       where id=(select id from public.stock_reservations where company_id=d.company_id and business_unit_id=d.business_unit_id and source_type='work_order' and source_id=d.work_order_id and item_id=l.item_id and status in('active','part_consumed') order by created_at limit 1 for update);
       update public.production_material_requirements set issued_qty=least(required_qty,issued_qty+v_qty),status=case when issued_qty+v_qty>=required_qty then 'issued' else 'part_issued' end,updated_at=now() where id=l.production_material_requirement_id;
     end if;
   else
     select id,quantity into v_stock_id,v_prev from public.warehouse_stock where company_id=d.company_id and business_unit_id=d.business_unit_id and item_id=l.item_id and warehouse_id=d.to_warehouse_id and godown_id=d.to_godown_id for update;
     v_prev:=coalesce(v_prev,0); select name into v_godown from public.godowns where id=d.to_godown_id;
     if v_stock_id is null then insert into public.warehouse_stock(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,quantity) values(public.legacy_data_user_id(),d.company_id,d.business_unit_id,l.item_id,d.to_warehouse_id,d.to_godown_id,v_godown,v_qty) returning id into v_stock_id;
     else update public.warehouse_stock set quantity=v_prev+v_qty,updated_at=now() where id=v_stock_id; end if;
     insert into public.stock_movements(user_id,company_id,business_unit_id,item_id,warehouse_id,godown_id,godown,type,qty,reference,unit_cost,source_type,source_id,previous_qty,resulting_qty,adjustment_action,lot_id,bin_id,inventory_document_id,created_by)
     values(public.legacy_data_user_id(),d.company_id,d.business_unit_id,l.item_id,d.to_warehouse_id,d.to_godown_id,v_godown,'in',v_qty,d.document_no,v_cost,d.document_type,d.id,v_prev,v_prev+v_qty,case when d.document_type='transfer' then 'transfer_receipt' when d.document_type='material_return' then 'material_return' else 'finished_goods_receipt' end,l.lot_id,l.to_bin_id,d.id,auth.uid());
     insert into public.inventory_valuation_layers(company_id,business_unit_id,item_id,warehouse_id,godown_id,lot_id,valuation_method,source_type,source_id,original_qty,remaining_qty,unit_cost)
     values(d.company_id,d.business_unit_id,l.item_id,d.to_warehouse_id,d.to_godown_id,l.lot_id,coalesce(s.valuation_method,'weighted_average'),d.document_type,d.id,v_qty,v_qty,v_cost);
   end if;
   v_total:=v_total+(v_qty*v_cost); v_count:=v_count+1;
 end loop;
 update public.inventory_posting_events set stock_movement_count=v_count,total_cost=v_total where id=v_event_id;
 if d.document_type='transfer' and v_event_type='dispatch' then update public.inventory_control_documents set status='in_transit',dispatched_at=now(),updated_at=now() where id=d.id;
 else update public.inventory_control_documents set status='posted',received_at=case when d.document_type='transfer' then now() else received_at end,posted_by=auth.uid(),updated_at=now() where id=d.id; end if;
 if d.work_order_id is not null and d.document_type in('material_issue','material_return','finished_goods_receipt') then
   insert into public.production_cost_snapshots(company_id,business_unit_id,work_order_id,snapshot_type,material_cost)
   values(d.company_id,d.business_unit_id,d.work_order_id,'actual',case when d.document_type='material_return' then -v_total else v_total end)
   on conflict(work_order_id,snapshot_type) do update set material_cost=public.production_cost_snapshots.material_cost+excluded.material_cost,captured_at=now(),captured_by=auth.uid();
 end if;
 if coalesce(s.auto_create_accounting_queue,true) and d.document_type<>'transfer' then
   if d.document_type='material_issue' then v_debit:=s.wip_account_id;v_credit:=s.inventory_account_id;
   elsif d.document_type='material_return' then v_debit:=s.inventory_account_id;v_credit:=s.wip_account_id;
   else v_debit:=s.inventory_account_id;v_credit:=s.wip_account_id; end if;
   v_queue_status:=case when v_debit is not null and v_credit is not null then 'ready' else 'pending_mapping' end;
   insert into public.inventory_accounting_queue(company_id,business_unit_id,posting_event_id,document_id,queue_type,amount,debit_account_id,credit_account_id,status,notes)
   values(d.company_id,d.business_unit_id,v_event_id,d.id,d.document_type,v_total,v_debit,v_credit,v_queue_status,case when v_queue_status='pending_mapping' then 'Configure Inventory and WIP accounts before journal creation.' end);
 end if;
 return jsonb_build_object('success',true,'event',v_event_type,'movement_count',v_count,'total_cost',round(v_total,2),'status',(select status from public.inventory_control_documents where id=d.id));
end $$;

revoke all on function public.generate_work_order_material_requirements(uuid) from public,anon;
revoke all on function public.reserve_work_order_materials(uuid,uuid,uuid) from public,anon;
revoke all on function public.post_inventory_control_document(uuid) from public,anon;
grant execute on function public.generate_work_order_material_requirements(uuid),public.reserve_work_order_materials(uuid,uuid,uuid),public.post_inventory_control_document(uuid) to authenticated;

create index if not exists idx_inventory_posting_events_doc on public.inventory_posting_events(document_id,event_type);
create index if not exists idx_inventory_accounting_queue_status on public.inventory_accounting_queue(company_id,business_unit_id,status,created_at);
create index if not exists idx_inventory_cost_consumptions_event on public.inventory_cost_consumptions(posting_event_id);

create or replace view public.inventory_posting_control_summary with(security_invoker=true) as
select d.id,d.company_id,d.business_unit_id,d.document_no,d.document_type,d.document_date,d.status,d.work_order_id,
 coalesce((select sum(l.quantity) from public.inventory_control_document_lines l where l.document_id=d.id),0) total_quantity,
 e.event_type,e.stock_movement_count,e.total_cost,e.posted_at,
 q.status accounting_status,q.journal_entry_id
from public.inventory_control_documents d
left join lateral(select * from public.inventory_posting_events x where x.document_id=d.id order by x.posted_at desc limit 1)e on true
left join public.inventory_accounting_queue q on q.posting_event_id=e.id;
revoke all on public.inventory_posting_control_summary from anon;
grant select on public.inventory_posting_control_summary to authenticated;
