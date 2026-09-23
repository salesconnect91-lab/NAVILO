create or replace function public.close_fiscal_year(p_fiscal_year integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_user uuid:=public.legacy_data_user_id();
  v_company uuid:=public.current_company_id();
  v_unit uuid:=public.current_business_unit_id();
  v_unit_code text;
  v_start date;
  v_end date;
  v_closure uuid;
  v_journal uuid;
  v_journal_no text;
  v_retained uuid;
  v_net numeric:=0;
  v_debits numeric:=0;
  v_credits numeric:=0;
  v_trial_difference numeric:=0;
  v_line_count integer:=0;
  r record;
begin
  perform public.assert_module_permission('accounting','post');
  if v_user is null or v_company is null or v_unit is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;
  if p_fiscal_year<2000 or p_fiscal_year>2200 then raise exception 'Invalid financial year.'; end if;

  select nullif(regexp_replace(upper(coalesce(b.code,'')),'[^A-Z0-9]+','','g'),'')
  into v_unit_code
  from public.business_units b
  where b.id=v_unit and b.company_id=v_company and b.is_active;
  if v_unit_code is null then v_unit_code:=upper(substr(replace(v_unit::text,'-',''),1,8)); end if;

  v_start:=make_date(p_fiscal_year,1,1);
  v_end:=make_date(p_fiscal_year,12,31);
  v_journal_no:='YEC-'||p_fiscal_year||'-'||v_unit_code;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||v_unit::text||':fiscal-close:'||p_fiscal_year::text,0));

  if exists(select 1 from public.fiscal_year_closures where company_id=v_company and business_unit_id=v_unit and fiscal_year=p_fiscal_year) then
    raise exception 'Financial year % has already been closed for this business unit.',p_fiscal_year;
  end if;

  if (select count(*) from public.accounting_periods where company_id=v_company and period_start>=v_start and period_end<=v_end)<>12
     or exists(select 1 from public.accounting_periods where company_id=v_company and period_start>=v_start and period_end<=v_end and status<>'closed') then
    raise exception 'All 12 monthly accounting periods for the active company must exist and be closed first.';
  end if;

  if exists(select 1 from public.journal_entries where company_id=v_company and business_unit_id=v_unit and entry_date between v_start and v_end and status='draft') then
    raise exception 'Draft journal entries exist in this business unit/year.';
  end if;

  select round(coalesce(sum(debit-credit),0),2)
  into v_trial_difference
  from public.ledgers
  where company_id=v_company and business_unit_id=v_unit and entry_date between v_start and v_end;
  if abs(v_trial_difference)>=0.01 then
    raise exception 'Trial Balance is not balanced for %. Difference: %',p_fiscal_year,v_trial_difference;
  end if;

  if exists(
    select 1 from public.journal_entries je
    where je.company_id=v_company and je.business_unit_id=v_unit and je.entry_date between v_start and v_end and je.status='posted'
      and ((select count(*) from public.journal_lines jl where jl.entry_id=je.id and jl.company_id=v_company and jl.business_unit_id=v_unit)
        <>(select count(*) from public.ledgers l where l.journal_entry_id=je.id and l.company_id=v_company and l.business_unit_id=v_unit))
  ) then
    raise exception 'One or more posted journals are not fully represented in General Ledger.';
  end if;

  select am.account_id into v_retained
  from public.account_mappings am
  join public.chart_of_accounts coa on coa.id=am.account_id
  where am.user_id=v_user and am.company_id=v_company and am.mapping_key='retained_earnings'
    and coa.company_id=v_company and coa.type='equity' and coa.is_active=true and coa.is_group=false
  limit 1;
  if v_retained is null then raise exception 'Active Retained Earnings account mapping is required.'; end if;

  select round(coalesce(sum(l.credit-l.debit),0),2) into v_net
  from public.ledgers l
  join public.chart_of_accounts coa on coa.id=l.account_id and coa.company_id=v_company
  where l.company_id=v_company and l.business_unit_id=v_unit and l.entry_date between v_start and v_end
    and coa.type in('revenue','expense');

  insert into public.fiscal_year_closures(
    user_id,company_id,business_unit_id,fiscal_year,year_start,year_end,status,net_profit_loss,retained_earnings_account_id
  ) values(v_user,v_company,v_unit,p_fiscal_year,v_start,v_end,'processing',v_net,v_retained)
  returning id into v_closure;

  insert into public.journal_entries(
    user_id,company_id,business_unit_id,entry_no,entry_date,description,status,trans_type,fiscal_year_closure_id
  ) values(
    v_user,v_company,v_unit,v_journal_no,v_end,'Financial year closing '||p_fiscal_year,'draft','Year End Closing',v_closure
  ) returning id into v_journal;

  for r in
    select coa.id,coa.code,coa.name,round(sum(l.debit-l.credit),2) net_debit
    from public.ledgers l
    join public.chart_of_accounts coa on coa.id=l.account_id and coa.company_id=v_company
    where l.company_id=v_company and l.business_unit_id=v_unit and l.entry_date between v_start and v_end
      and coa.type in('revenue','expense')
    group by coa.id,coa.code,coa.name
    having abs(round(sum(l.debit-l.credit),2))>=.01
    order by coa.code
  loop
    insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit)
    values(
      v_user,v_company,v_unit,v_journal,r.id,r.code||' - '||r.name,
      case when r.net_debit<0 then abs(r.net_debit) else 0 end,
      case when r.net_debit>0 then r.net_debit else 0 end
    );
    v_line_count:=v_line_count+1;
  end loop;

  if abs(v_net)>=.01 then
    insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,debit,credit)
    select v_user,v_company,v_unit,v_journal,coa.id,coa.code||' - '||coa.name,
      case when v_net<0 then abs(v_net) else 0 end,
      case when v_net>0 then v_net else 0 end
    from public.chart_of_accounts coa where coa.id=v_retained and coa.company_id=v_company;
    v_line_count:=v_line_count+1;
  end if;

  if v_line_count>0 then
    select round(sum(debit),2),round(sum(credit),2)
    into v_debits,v_credits
    from public.journal_lines
    where entry_id=v_journal and company_id=v_company and business_unit_id=v_unit;
    if abs(v_debits-v_credits)>=.01 then raise exception 'Generated year-end journal is not balanced.'; end if;
    perform public.post_journal_entry(v_journal);
  else
    delete from public.journal_entries where id=v_journal and company_id=v_company and business_unit_id=v_unit;
    v_journal:=null;
  end if;

  update public.fiscal_year_closures
  set status='closed',closing_journal_id=v_journal,closed_at=now(),closed_by=auth.uid()
  where id=v_closure and company_id=v_company and business_unit_id=v_unit;

  insert into public.fiscal_year_opening_balances(
    user_id,company_id,business_unit_id,closure_id,opening_year,account_id,debit_balance,credit_balance
  )
  select v_user,v_company,v_unit,v_closure,p_fiscal_year+1,coa.id,
    greatest(round(sum(l.debit-l.credit),2),0),
    greatest(round(sum(l.credit-l.debit),2),0)
  from public.ledgers l
  join public.chart_of_accounts coa on coa.id=l.account_id and coa.company_id=v_company
  where l.company_id=v_company and l.business_unit_id=v_unit and l.entry_date<=v_end
    and coa.type in('asset','liability','equity')
  group by coa.id
  having abs(round(sum(l.debit-l.credit),2))>=.01;

  insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,new_data,metadata)
  values(
    v_user,'accounting','CLOSE_YEAR','fiscal_year_closures',v_closure,p_fiscal_year::text,auth.uid(),
    jsonb_build_object('status','closed','net_profit_loss',v_net),
    jsonb_build_object('company_id',v_company,'business_unit_id',v_unit,'closing_journal_id',v_journal,'closing_journal_no',v_journal_no,'opening_year',p_fiscal_year+1)
  );

  return jsonb_build_object(
    'success',true,'closure_id',v_closure,'company_id',v_company,'business_unit_id',v_unit,
    'fiscal_year',p_fiscal_year,'net_profit_loss',v_net,'closing_journal_id',v_journal,
    'closing_journal_no',v_journal_no,'opening_year',p_fiscal_year+1
  );
end;
$function$;
