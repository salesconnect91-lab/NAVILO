-- One-time ORBIT historical opening attribution request (no journal/master creation).
-- Execute only against the verified NAVILO production ORBIT/ORBIT cutover.
do $$
declare
  c uuid;b uuid;j uuid;a uuid;
  r record;line_id uuid;n integer;claimed numeric;
begin
  select id into strict c from public.companies where code='ORBITUSMAN';
  select id into strict b from public.business_units where company_id=c and upper(btrim(name))='ORBIT';
  select id into strict j from public.journal_entries where company_id=c and business_unit_id=b
    and entry_no='COB-20260901-9488C1' and status='posted'
    and entry_date='2026-09-01' and source_document_type='cutover_opening_balances';
  select id into strict a from public.chart_of_accounts where company_id=c and code='3005'
    and name='August 2026 Undistributed Profit' and type='equity';
  select count(*),round(sum(l.credit-l.debit),2) into n,claimed
  from public.journal_lines l where l.entry_id=j and l.account_id=a
    and l.company_id=c and l.business_unit_id=b;
  if n<>5 or claimed<>44797.63 then
    raise exception 'Source opening profit does not match verified five GL lines: count=%, net=%',n,claimed;
  end if;
  if exists(select 1 from public.transport_vehicle_profit_import_queue
    where company_id=c and business_unit_id=b and status='linked') then
    raise exception 'Fleet opening profit has already been linked, do not replay request';
  end if;
  for r in
    select * from (values
      ('7494'::text,'Trailer'::text,29361.03::numeric),
      ('5731'::text,'Trailer'::text,2332.54::numeric),
      ('2512'::text,'Trailer'::text,-7856.28::numeric),
      ('7979'::text,'Dyna'::text,9372.65::numeric)
    ) as x(vehicle_no,truck_type_name,net_profit)
  loop
    select id into strict line_id from public.journal_lines l
    where l.entry_id=j and l.account_id=a and l.company_id=c and l.business_unit_id=b
      and round(l.credit-l.debit,2)=r.net_profit;
    insert into public.transport_vehicle_profit_import_queue(
      company_id,business_unit_id,vehicle_no,truck_type_name,
      confirmed_owned_on,profit_month,net_profit,source_journal_line_id)
    values(c,b,r.vehicle_no,r.truck_type_name,'2026-08-31','2026-08-01',r.net_profit,line_id)
    on conflict(company_id,business_unit_id,vehicle_no,profit_month) do nothing;
  end loop;
  select count(*),round(sum(net_profit),2) into n,claimed
  from public.transport_vehicle_profit_import_queue
  where company_id=c and business_unit_id=b and profit_month='2026-08-01';
  if n<>4 or claimed<>33209.94 then
    raise exception 'Four vehicle import requests must total SAR 33209.94, got % rows and %',n,claimed;
  end if;
end $$;