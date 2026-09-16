begin;

-- Approval configuration is private company data. Anonymous table privileges were
-- inherited from an early broad grant and are not required by the application.
revoke all on public.approval_workflows, public.approval_steps, public.approval_requests from anon;

alter table public.approval_requests
  add column if not exists current_step_no integer not null default 1,
  add column if not exists request_context jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz;

alter table public.approval_requests
  drop constraint if exists approval_requests_company_id_business_unit_id_document_type_key;

create unique index if not exists uq_approval_request_document
  on public.approval_requests(company_id, coalesce(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), document_type, document_id);

create table if not exists public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade default public.current_company_id(),
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  step_no integer not null check (step_no > 0),
  decision text not null check (decision in ('approved','rejected')),
  notes text,
  decided_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  decided_at timestamptz not null default now(),
  unique(request_id, step_no, decided_by)
);

create index if not exists idx_approval_decisions_company_request
  on public.approval_decisions(company_id, request_id, step_no);

create table if not exists public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade default public.current_company_id(),
  business_unit_id uuid references public.business_units(id) on delete restrict,
  approver_role text not null check (nullif(btrim(approver_role),'') is not null),
  delegator_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  delegate_user_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  is_active boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  check (delegate_user_id <> delegator_user_id),
  check (ends_at > starts_at)
);

create index if not exists idx_approval_delegations_lookup
  on public.approval_delegations(company_id, delegate_user_id, approver_role, starts_at, ends_at)
  where is_active;

alter table public.approval_decisions enable row level security;
alter table public.approval_delegations enable row level security;

revoke all on public.approval_decisions, public.approval_delegations from anon;
revoke insert, update, delete on public.approval_decisions from authenticated;
grant select on public.approval_decisions to authenticated;
grant select, insert, update, delete on public.approval_delegations to authenticated;

drop policy if exists approval_decisions_select on public.approval_decisions;
create policy approval_decisions_select on public.approval_decisions
for select to authenticated
using (
  company_id = (select public.current_company_id())
  and exists (
    select 1 from public.approval_requests r
    where r.id = request_id
      and (
        r.requested_by = (select auth.uid())
        or public.can_manage_company_access(r.company_id)
        or exists (
          select 1 from public.approval_steps s
          left join public.business_unit_memberships bm
            on bm.company_id = r.company_id and bm.business_unit_id = r.business_unit_id
           and bm.user_id = (select auth.uid()) and bm.is_active
          left join public.company_memberships cm
            on cm.company_id = r.company_id and cm.user_id = (select auth.uid()) and cm.is_active
          where s.workflow_id = r.workflow_id and s.step_no = r.current_step_no
            and coalesce(bm.role, cm.role) in (s.approver_role, 'company_owner', 'admin')
        )
      )
  )
);

drop policy if exists approval_delegations_select on public.approval_delegations;
create policy approval_delegations_select on public.approval_delegations
for select to authenticated
using (
  company_id = (select public.current_company_id())
  and (delegator_user_id = (select auth.uid()) or delegate_user_id = (select auth.uid()) or public.can_manage_company_access(company_id))
);
drop policy if exists approval_delegations_insert on public.approval_delegations;
create policy approval_delegations_insert on public.approval_delegations
for insert to authenticated
with check (
  company_id = (select public.current_company_id())
  and delegator_user_id = (select auth.uid())
  and exists (
    select 1 from public.company_memberships cm
    where cm.company_id = approval_delegations.company_id and cm.user_id = (select auth.uid()) and cm.is_active
      and cm.role in (approval_delegations.approver_role, 'company_owner', 'admin')
  )
);
drop policy if exists approval_delegations_update on public.approval_delegations;
create policy approval_delegations_update on public.approval_delegations
for update to authenticated
using (company_id = (select public.current_company_id()) and (delegator_user_id = (select auth.uid()) or public.can_manage_company_access(company_id)))
with check (company_id = (select public.current_company_id()) and (delegator_user_id = (select auth.uid()) or public.can_manage_company_access(company_id)));
drop policy if exists approval_delegations_delete on public.approval_delegations;
create policy approval_delegations_delete on public.approval_delegations
for delete to authenticated
using (company_id = (select public.current_company_id()) and (delegator_user_id = (select auth.uid()) or public.can_manage_company_access(company_id)));

-- Request visibility includes the maker, company access managers and the current
-- approver. Configuration changes remain restricted to company access managers.
drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests
for select to authenticated
using (
  company_id = (select public.current_company_id())
  and (
    requested_by = (select auth.uid())
    or public.can_manage_company_access(company_id)
    or exists (
      select 1 from public.approval_steps s
      left join public.business_unit_memberships bm
        on bm.company_id = approval_requests.company_id and bm.business_unit_id = approval_requests.business_unit_id
       and bm.user_id = (select auth.uid()) and bm.is_active
      left join public.company_memberships cm
        on cm.company_id = approval_requests.company_id and cm.user_id = (select auth.uid()) and cm.is_active
      where s.workflow_id = approval_requests.workflow_id and s.step_no = approval_requests.current_step_no
        and coalesce(bm.role, cm.role) in (s.approver_role, 'company_owner', 'admin')
    )
    or exists (
      select 1 from public.approval_steps s
      join public.approval_delegations d
        on d.company_id = approval_requests.company_id and d.approver_role = s.approver_role
       and d.delegate_user_id = (select auth.uid()) and d.is_active
       and now() between d.starts_at and d.ends_at
       and (d.business_unit_id is null or d.business_unit_id = approval_requests.business_unit_id)
      where s.workflow_id = approval_requests.workflow_id and s.step_no = approval_requests.current_step_no
    )
  )
);

revoke insert, update, delete on public.approval_requests from authenticated;
grant select on public.approval_requests to authenticated;

create or replace function public.submit_approval_request(
  p_document_type text,
  p_document_id uuid,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_bu uuid := public.current_business_unit_id();
  v_workflow public.approval_workflows%rowtype;
  v_request public.approval_requests%rowtype;
  v_amount numeric := coalesce(nullif(p_context->>'amount','')::numeric, 0);
begin
  if v_user is null or v_company is null then raise exception 'Authentication and company context are required.'; end if;
  if p_document_id is null or nullif(btrim(p_document_type),'') is null then raise exception 'Document type and document ID are required.'; end if;

  select w.* into v_workflow
  from public.approval_workflows w
  where w.company_id = v_company and w.is_active
    and w.document_type = lower(btrim(p_document_type))
    and (w.business_unit_id = v_bu or w.business_unit_id is null)
    and (not (w.conditions ? 'min_amount') or v_amount >= (w.conditions->>'min_amount')::numeric)
    and (not (w.conditions ? 'max_amount') or v_amount <= (w.conditions->>'max_amount')::numeric)
    and exists (select 1 from public.approval_steps s where s.workflow_id = w.id)
  order by (w.business_unit_id is not null) desc,
           coalesce((w.conditions->>'min_amount')::numeric, 0) desc,
           w.created_at asc
  limit 1;

  if v_workflow.id is null then
    return jsonb_build_object('approval_required', false, 'status', 'not_required');
  end if;

  insert into public.approval_requests(company_id,business_unit_id,workflow_id,document_type,document_id,status,requested_by,current_step_no,request_context,updated_at)
  values(v_company,v_bu,v_workflow.id,lower(btrim(p_document_type)),p_document_id,'pending',v_user,1,coalesce(p_context,'{}'::jsonb),now())
  on conflict (company_id, (coalesce(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)), document_type, document_id)
  do update set workflow_id=excluded.workflow_id, status='pending', requested_by=excluded.requested_by,
                requested_at=now(), current_step_no=1, request_context=excluded.request_context,
                decided_by=null, decided_at=null, decision_notes=null, completed_at=null, updated_at=now()
  where public.approval_requests.status in ('rejected','cancelled')
  returning * into v_request;

  if v_request.id is null then
    select * into v_request from public.approval_requests r
    where r.company_id=v_company and r.document_type=lower(btrim(p_document_type)) and r.document_id=p_document_id
      and r.business_unit_id is not distinct from v_bu;
  end if;
  return jsonb_build_object('approval_required',true,'request_id',v_request.id,'status',v_request.status,'current_step_no',v_request.current_step_no);
end;
$$;

create or replace function public.decide_approval_request(p_request_id uuid, p_decision text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_request public.approval_requests%rowtype;
  v_step public.approval_steps%rowtype;
  v_role text;
  v_authorized boolean := false;
  v_count integer;
  v_next integer;
begin
  if v_user is null then raise exception 'Authentication is required.'; end if;
  if lower(coalesce(p_decision,'')) not in ('approved','rejected') then raise exception 'Decision must be approved or rejected.'; end if;

  select * into v_request from public.approval_requests where id=p_request_id for update;
  if v_request.id is null or v_request.company_id <> public.current_company_id() then raise exception 'Approval request not found.'; end if;
  if v_request.status <> 'pending' then raise exception 'Only pending requests can be decided.'; end if;
  if v_request.requested_by = v_user then raise exception 'Maker-checker rule: requester cannot approve or reject their own request.'; end if;
  select * into v_step from public.approval_steps where workflow_id=v_request.workflow_id and step_no=v_request.current_step_no;
  if v_step.id is null then raise exception 'Approval step configuration is missing.'; end if;

  select coalesce(bm.role,cm.role) into v_role
  from (select 1) x
  left join public.business_unit_memberships bm on bm.company_id=v_request.company_id and bm.business_unit_id=v_request.business_unit_id and bm.user_id=v_user and bm.is_active
  left join public.company_memberships cm on cm.company_id=v_request.company_id and cm.user_id=v_user and cm.is_active
  limit 1;
  v_authorized := v_role in (v_step.approver_role,'company_owner','admin') or public.is_platform_owner();
  if not v_authorized then
    select exists(
      select 1 from public.approval_delegations d
      where d.company_id=v_request.company_id and d.delegate_user_id=v_user and d.approver_role=v_step.approver_role
        and d.is_active and now() between d.starts_at and d.ends_at
        and (d.business_unit_id is null or d.business_unit_id=v_request.business_unit_id)
    ) into v_authorized;
  end if;
  if not v_authorized then raise exception 'You are not authorized for this approval step.'; end if;

  insert into public.approval_decisions(company_id,request_id,step_no,decision,notes,decided_by)
  values(v_request.company_id,v_request.id,v_request.current_step_no,lower(p_decision),nullif(btrim(coalesce(p_notes,'')),''),v_user);

  if lower(p_decision)='rejected' then
    update public.approval_requests set status='rejected',decided_by=v_user,decided_at=now(),decision_notes=p_notes,completed_at=now(),updated_at=now() where id=v_request.id;
    return jsonb_build_object('request_id',v_request.id,'status','rejected');
  end if;

  select count(*) into v_count from public.approval_decisions where request_id=v_request.id and step_no=v_request.current_step_no and decision='approved';
  if v_count < v_step.min_approvals then
    return jsonb_build_object('request_id',v_request.id,'status','pending','current_step_no',v_request.current_step_no,'approvals',v_count,'required',v_step.min_approvals);
  end if;
  select min(step_no) into v_next from public.approval_steps where workflow_id=v_request.workflow_id and step_no>v_request.current_step_no;
  if v_next is null then
    update public.approval_requests set status='approved',decided_by=v_user,decided_at=now(),completed_at=now(),updated_at=now() where id=v_request.id;
    return jsonb_build_object('request_id',v_request.id,'status','approved');
  end if;
  update public.approval_requests set current_step_no=v_next,updated_at=now() where id=v_request.id;
  return jsonb_build_object('request_id',v_request.id,'status','pending','current_step_no',v_next);
end;
$$;

revoke all on function public.submit_approval_request(text,uuid,jsonb) from public,anon;
grant execute on function public.submit_approval_request(text,uuid,jsonb) to authenticated;
revoke all on function public.decide_approval_request(uuid,text,text) from public,anon;
grant execute on function public.decide_approval_request(uuid,text,text) to authenticated;

comment on table public.approval_decisions is 'Immutable maker-checker decision history for each approval step.';
comment on table public.approval_delegations is 'Time-bound approval authority delegated to another active company user.';
comment on function public.submit_approval_request(text,uuid,jsonb) is 'Selects the most specific active workflow and opens or returns a document approval request.';
comment on function public.decide_approval_request(uuid,text,text) is 'Atomically records an approval decision and advances or completes the workflow.';

notify pgrst, 'reload schema';
commit;
