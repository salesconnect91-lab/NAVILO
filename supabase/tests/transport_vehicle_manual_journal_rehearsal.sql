-- Synthetic local fixtures, rollback; canonical posting and authenticated RPCs.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;cash uuid;rev uuid;exp uuid;equity uuid;je uuid;closing uuid;
 tt uuid;v1 uuid;v2 uuid;line_id uuid;reverse_id uuid;
 m date:=(date_trunc('year',current_date)-interval '4 months')::date;
 p jsonb;r jsonb;bad boolean;v numeric;before_count bigint;year integer;fy jsonb;
begin
 insert into auth.users(id,role,email,created_at,updated_at) values(u,'authenticated','monthly-'||u||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active) values(u,u,'monthly-'||u||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Monthly closing rehearsal','MC'||substr(u::text,1,8),'active') returning id into c;
 select id into b from public.business_units where company_id=c and is_default;
 update public.business_units set unit_type='transport' where id=b;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(c,b,u,'company_owner',true) on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(c,b,'accounting',true),(c,b,'transport',true),(c,b,'settings',true) on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.platform_features(feature_key,module_key,label,category,supported_actions,default_enabled,core_locked,is_active,source) values('journal','accounting','Journal Entries','transaction',array['view','create','edit','post','delete','print','export']::text[],true,false,true,'test') on conflict(feature_key) do update set supported_actions=excluded.supported_actions,default_enabled=true,is_active=true;
 insert into public.company_feature_entitlements(company_id,feature_key,enabled,action_overrides) values(c,'journal',true,'{}'::jsonb) on conflict(company_id,feature_key) do update set enabled=true;
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active) values(c,b,'MC','Monthly Branch','branch',true) returning id into loc;
 insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active) values(c,b,loc,u,'company_owner',true);
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.company_settings(user_id,company_id,company_name) values(u,c,'Monthly closing rehearsal');
 perform public.initialize_default_coa();
 select account_id into cash from public.account_mappings where company_id=c and mapping_key='cash';
 select id into rev from public.chart_of_accounts where company_id=c and type in ('revenue','income') and not is_group and is_active limit 1;
 select id into exp from public.chart_of_accounts where company_id=c and type='expense' and not is_group and is_active limit 1;
 select account_id into equity from public.account_mappings where company_id=c and mapping_key='retained_earnings';
 if equity is null then
 insert into public.chart_of_accounts(user_id,company_id,code,name,type,normal_balance,detail_type,is_active,is_group,allow_manual_entries) values(u,c,'MC-EQUITY','Undistributed Profit','equity','credit','Retained Earnings',true,false,true) returning id into equity;
 insert into public.account_mappings(user_id,company_id,mapping_key,account_id) values(u,c,'retained_earnings',equity);
 end if;
 if cash is null or rev is null or exp is null then raise exception 'Fixture COA missing: cash %, revenue %, expense %',cash,rev,exp;end if;

 insert into public.transport_truck_types(company_id,business_unit_id,name) values(c,b,'Trailer') returning id into tt;
 v1:=public.transport_create_vehicle_master('JE-2512',tt,'company',null,current_date-1);
 v2:=public.transport_create_vehicle_master('JE-5731',tt,'company',null,current_date-1);
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type)
 values(u,c,b,loc,'VEHICLE-JE',current_date,'Two vehicle repair costs','draft','Journal Entry') returning id into je;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,transport_vehicle_id)
 select u,c,b,loc,je,a.id,a.name,100,0,vehicle_ids.id from public.chart_of_accounts a cross join unnest(array[v1,v2])vehicle_ids(id) where a.id=exp;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
 select u,c,b,loc,je,id,name,0,200 from public.chart_of_accounts where id=cash returning id into line_id;
 bad:=false;begin update public.journal_lines set transport_vehicle_id=v1 where id=line_id;exception when others then if position('income or expense' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Cash line was attributed as vehicle profit';end if;
 bad:=false;begin update public.journal_lines set transport_vehicle_id=gen_random_uuid() where entry_id=je and account_id=exp;exception when others then if position('company-owned' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Invalid vehicle accepted';end if;
 bad:=false;begin update public.journal_entries set entry_date=current_date-2 where id=je;exception when others then if position('company-owned' in sqlerrm)>0 or position('Remove draft journal lines' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Header date bypassed vehicle ownership';end if;
 -- New policy: vehicle expense/income is posted only from its source invoice,
 -- not through an ordinary manual journal. Preserve draft/link validation coverage.
 set local role authenticated;
 bad:=false;
 begin
   perform public.post_journal_entry(je);
 exception when others then
   if position('Manual journals cannot post Income' in sqlerrm)>0 then bad:=true;
   else raise;end if;
 end;
 reset role;
 if not bad then raise exception 'Manual vehicle expense incorrectly posted as billing';end if;
 if exists(select 1 from public.journal_entries where id=je and status='posted')
    or exists(select 1 from public.ledgers where journal_entry_id=je)
 then raise exception 'Rejected manual expense still created GL rows';end if;
 raise notice 'PASS manual vehicle journal: invalid vehicle attribution denied; income/expense billing rejected with no GL writes';

end $$;
rollback;
