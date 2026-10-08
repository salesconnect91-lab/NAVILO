-- Support Custom Excel partner-to-GL linking; formula preview/posting remain disabled.
-- Existing rules and financial evidence are immutable.
begin;
create or replace function public.transport_profit_distribution_save_rule(
 p_method text,p_effective_from date,p_shares jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
 p jsonb;k text;n text;pct numeric;tot numeric:=0;cnt integer:=0;
 keys_seen text[]:=array[]::text[];account_seen uuid[]:=array[]::uuid[];gl uuid;aname text;ident uuid;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active Company/Business Unit required';end if;
 if not public.has_module_permission(c,'settings','edit') or not public.has_module_permission(c,'transport','view')
    or not public.has_module_permission(c,'accounting','view') then raise exception 'Owner settings edit and Accounting view required';end if;
 if not public.is_platform_owner() and not exists(select 1 from public.business_unit_memberships x where x.company_id=c
    and x.business_unit_id=b and x.user_id=auth.uid() and x.is_active and x.role in('company_owner','admin'))
    and not exists(select 1 from public.company_memberships x where x.company_id=c and x.user_id=auth.uid()
    and x.is_active and x.role in('company_owner','admin')) then raise exception 'Owner/Admin required';end if;
 if not exists(select 1 from public.business_units x where x.id=b and x.company_id=c and x.is_active and x.unit_type='transport')
    then raise exception 'Active Transport business required';end if;
 if p_effective_from is null or p_effective_from<>date_trunc('month',p_effective_from)::date
    then raise exception 'Effective month start is required';end if;
 if p_method not in ('fixed_percentage','custom_excel') or p_shares is null or jsonb_typeof(p_shares)<>'array'
    then raise exception 'Invalid method or shares';end if;
 if p_method in ('fixed_percentage','custom_excel') then
  for p in select value from jsonb_array_elements(p_shares) loop
   if jsonb_typeof(p)<>'object' then raise exception 'Invalid partner';end if;
   k:=lower(btrim(coalesce(p->>'key','')));n:=btrim(coalesce(p->>'name',''));
   if k!~'^[a-z0-9_-]{1,40}$' or length(n) not between 1 and 120 or k=any(keys_seen)
      then raise exception 'Invalid or duplicate partner';end if;
   if coalesce(p->>'percentage','')!~'^([0-9]{1,3})(\.[0-9]{1,2})?$'
      then raise exception 'Percentage supports max 2 decimal places';end if;
   pct:=(p->>'percentage')::numeric;
   if pct<0 or pct>100 then raise exception 'Percentage out of range';end if;
   if coalesce(p->>'account_id','')!~'^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      then raise exception 'Choose a valid partner Current Account GL';end if;
   gl:=(p->>'account_id')::uuid;
   if gl=any(account_seen) then raise exception 'Same Current Account cannot be shared between partners';end if;
   select a.name into aname from public.chart_of_accounts a where a.id=gl and a.company_id=c
       and a.type='equity' and lower(btrim(coalesce(a.detail_type,'')))='owners_equity'
       and not a.is_group and a.is_active and a.allow_manual_entries and a.account_role='general'
       and lower(a.name) like '%current%' and lower(a.name) not like '%capital%';
   if aname is null then raise exception 'Choose an active non-Capital owner Current Account from this Company';end if;
   if n<>aname then raise exception 'Partner name must match selected Chart of Accounts GL';end if;
   if exists(select 1 from public.transport_profit_distribution_rule_partners r
       where r.company_id=c and r.business_unit_id<>b and r.account_id=gl)
      then raise exception 'Current Account GL is reserved by a different business unit';end if;
   keys_seen:=array_append(keys_seen,k);account_seen:=array_append(account_seen,gl);
   tot:=tot+pct;cnt:=cnt+1;if cnt>20 then raise exception 'Maximum 20 partners';end if;
  end loop;
  if (p_method='fixed_percentage' and (cnt<2 or tot<>100))
       or (p_method='custom_excel' and (cnt=1 or tot<>0)) then
    raise exception 'Fixed Percentage requires two or more partners totaling 100 percent; Custom Excel requires zero or 2-20 mapped partners with ratio pending';
   end if;
 end if;
 if exists(select 1 from public.transport_profit_distribution_rules r where r.company_id=c
    and r.business_unit_id=b and r.effective_from=p_effective_from)
   then raise exception 'A rule already exists for this effective month. Choose a new month';end if;
 insert into public.transport_profit_distribution_rules
 (company_id,business_unit_id,method,effective_from,shares,status,created_by)
 values(c,b,p_method,p_effective_from,p_shares,
     case when p_method='fixed_percentage' then 'configured' else 'awaiting_excel' end,auth.uid()) returning id into ident;
 if jsonb_array_length(p_shares)>0 then
  for p in select value from jsonb_array_elements(p_shares) loop
   insert into public.transport_profit_distribution_rule_partners
     (rule_id,company_id,business_unit_id,account_id,partner_key,partner_name_snapshot,percentage)
   values (ident,c,b,(p->>'account_id')::uuid,lower(btrim(p->>'key')),btrim(p->>'name'),(p->>'percentage')::numeric);
  end loop;
 end if;
 return ident;
end $$;

create or replace function public.transport_profit_distribution_partner_ledger(
 p_account_id uuid,p_month date,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
 m date:=date_trunc('month',p_month)::date;n date:=(date_trunc('month',p_month)+interval '1 month')::date;
 rid uuid;opening numeric:=0;movements numeric:=0;txns bigint:=0;body jsonb:='[]'::jsonb;cap integer:=greatest(1,least(coalesce(p_limit,200),500));
begin
 if auth.uid() is null or c is null or b is null or p_month is null or p_account_id is null
   then raise exception 'Current company, GL account and month required';end if;
 if not public.has_module_permission(c,'settings','view') or not public.has_module_permission(c,'transport','view')
   or not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting/Transport/Settings view required';end if;
 if not public.is_platform_owner() and not exists(select 1 from public.business_unit_memberships x
    where x.company_id=c and x.business_unit_id=b and x.user_id=auth.uid() and x.is_active and x.role in('company_owner','admin'))
   and not exists(select 1 from public.company_memberships x where x.company_id=c and x.user_id=auth.uid()
    and x.is_active and x.role in('company_owner','admin')) then raise exception 'Owner/Admin required';end if;
 select r.id into rid from public.transport_profit_distribution_rules r
   where r.company_id=c and r.business_unit_id=b and r.effective_from<=m
   order by r.effective_from desc limit 1;
 if rid is null or not exists(select 1 from public.transport_profit_distribution_rule_partners x
     where x.rule_id=rid and x.company_id=c and x.business_unit_id=b and x.account_id=p_account_id)
    then raise exception 'GL not linked to effective business profit distribution rule';end if;
 select coalesce(sum(l.credit-l.debit),0) into opening
 from public.journal_lines l join public.journal_entries e on e.id=l.entry_id and e.company_id=c
   and e.business_unit_id=b where l.company_id=c and l.business_unit_id=b and l.account_id=p_account_id
   and e.status='posted' and e.entry_date<m;
 select coalesce(sum(l.credit-l.debit),0),count(*) into movements,txns
 from public.journal_lines l join public.journal_entries e on e.id=l.entry_id and e.company_id=c
   and e.business_unit_id=b where l.company_id=c and l.business_unit_id=b and l.account_id=p_account_id
   and e.status='posted' and e.entry_date>=m and e.entry_date<n;
 select coalesce(jsonb_agg(jsonb_build_object(
   'entry_date',x.entry_date,'entry_no',x.entry_no,'description',x.description,
   'debit',x.debit,'credit',x.credit,'balance',opening+x.running_balance)
   order by x.entry_date,x.created_at,x.entry_id,x.line_id),'[]'::jsonb)
 into body from (
  select e.entry_date,e.entry_no,e.description,e.created_at,e.id entry_id,l.id line_id,l.debit,l.credit,
      sum(l.credit-l.debit) over(order by e.entry_date,e.created_at,e.id,l.id) running_balance
  from public.journal_lines l join public.journal_entries e on e.id=l.entry_id and e.company_id=c and e.business_unit_id=b
  where l.company_id=c and l.business_unit_id=b and l.account_id=p_account_id
    and e.status='posted' and e.entry_date>=m and e.entry_date<n
  order by e.entry_date,e.created_at,e.id,l.id limit cap
 ) x;
 return jsonb_build_object(
   'month',m,'account_id',p_account_id,'opening_balance',opening,
   'month_movement',movements,'closing_balance',opening+movements,
   'entry_count',txns,'truncated',txns>cap,'entries',body,
   'balance_sign','credit_positive_equity','posted_only',true);
end $$;

commit;
