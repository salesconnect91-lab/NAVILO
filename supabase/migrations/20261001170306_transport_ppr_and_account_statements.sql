-- Additive scoped reporting and private PPR evidence. Canonical payroll remains authoritative.
create policy transport_ppr_employee_lookup on public.employees for select to authenticated
using(company_id=public.current_company_id() and public.has_module_permission(company_id,'transport','view')
 and public.has_transport_action_permission(company_id,'ppr_receive'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('transport-ppr','transport-ppr',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function public.transport_ppr_object_allowed(p_name text,p_write boolean default false) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.transport_trips t
 where t.company_id=public.current_company_id() and t.business_unit_id=public.current_business_unit_id()
 and split_part(p_name,'/',1)=t.company_id::text and split_part(p_name,'/',2)=t.business_unit_id::text
 and split_part(p_name,'/',3)=public.current_operating_location_id()::text
 and split_part(p_name,'/',4)=t.id::text and array_length(string_to_array(p_name,'/'),1)=5
 and public.has_module_permission(t.company_id,'transport','view')
 and (not p_write or public.has_transport_action_permission(t.company_id,'ppr_receive')))
$$;
revoke all on function public.transport_ppr_object_allowed(text,boolean) from public,anon;
grant execute on function public.transport_ppr_object_allowed(text,boolean) to authenticated;
create policy transport_ppr_read on storage.objects for select to authenticated
using(bucket_id='transport-ppr' and public.transport_ppr_object_allowed(name,false));
create policy transport_ppr_upload on storage.objects for insert to authenticated
with check(bucket_id='transport-ppr' and public.transport_ppr_object_allowed(name,true));
-- Only unused uploads can be removed; referenced evidence is retained.
create policy transport_ppr_remove_unused on storage.objects for delete to authenticated
using(bucket_id='transport-ppr' and public.transport_ppr_object_allowed(name,true)
 and not exists(select 1 from public.transport_trips t where t.ppr_attachment_path=storage.objects.name));
create function public.transport_ppr_attachment_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.ppr_attachment_path is not null and (tg_op='INSERT' or new.ppr_attachment_path is distinct from old.ppr_attachment_path) then
   if new.ppr_status<>'received' or not public.has_transport_action_permission(new.company_id,'ppr_receive')
     or not public.transport_ppr_object_allowed(new.ppr_attachment_path,true)
     or not exists(select 1 from storage.objects where bucket_id='transport-ppr' and name=new.ppr_attachment_path)
   then raise exception 'PPR attachment requires a saved receipt and scoped private upload';end if;
 end if;
 return new;
end $$;
revoke all on function public.transport_ppr_attachment_guard() from public,anon,authenticated;
create trigger zz_transport_ppr_attachment_guard before insert or update of ppr_attachment_path on public.transport_trips
for each row execute function public.transport_ppr_attachment_guard();

create view public.transport_driver_account_movements with(security_invoker=true) as
with sources as (
 select 'accrual:'||a.id event_id,a.company_id,a.business_unit_id,a.operating_location_id,a.trip_id,
 s.employee_id,s.journal_entry_id,a.amount,'salary_accrual'::text event_type
 from public.transport_driver_accrual_attributions a join public.employee_salary_accruals s on s.id=a.accrual_id
 union all
 select 'payment:'||a.id,a.company_id,a.business_unit_id,a.operating_location_id,a.trip_id,
 s.employee_id,s.journal_entry_id,-a.amount,'salary_payment'::text
 from public.transport_driver_payment_attributions a join public.employee_salary_payments s on s.id=a.salary_payment_id
), posted as (
 select s.*,t.trip_no,coalesce(e.name,'Payroll employee '||s.employee_id::text) party_name,
 j.entry_no,j.entry_date event_date,j.description,j.created_at,
 greatest(s.amount,0) debit,greatest(-s.amount,0) credit
 from sources s join public.transport_trips t on t.id=s.trip_id and t.company_id=s.company_id
 and t.business_unit_id=s.business_unit_id
 join public.journal_entries j on j.id=s.journal_entry_id and j.status='posted'
 left join public.employees e on e.id=s.employee_id and e.company_id=s.company_id
 where s.company_id=public.current_company_id() and s.business_unit_id=public.current_business_unit_id()
 and s.operating_location_id=public.current_operating_location_id()
 and public.has_module_permission(s.company_id,'transport','view')
)
select event_id,company_id,business_unit_id,operating_location_id,trip_id,employee_id,party_name,journal_entry_id,
 amount,event_type,trip_no,entry_no,event_date,description,created_at,debit,credit from posted
union all
select p.event_id||':reversal:'||r.id,p.company_id,p.business_unit_id,p.operating_location_id,p.trip_id,p.employee_id,p.party_name,
 r.id,-p.amount,'reversal_'||p.event_type,p.trip_no,r.entry_no,r.entry_date,r.description,r.created_at,p.credit,p.debit
from posted p join public.journal_entries r on r.reversal_of_entry_id=p.journal_entry_id and r.status='posted';
grant select on public.transport_driver_account_movements to authenticated;
