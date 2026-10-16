-- Synthetic fixtures only; invoked within the isolated reader rehearsal.
create or replace function pg_temp.assert_register_snapshot_queries(p_scale boolean default false) returns void
language plpgsql security definer set search_path to public,pg_temp as $test$
declare actual jsonb;expected jsonb;test_case jsonb;header_key text;direction text;
 ids uuid[];before_rows jsonb;after_rows jsonb;refreshed timestamptz;target uuid;
begin
 for test_case in select value from jsonb_array_elements(case when p_scale then '[
  {"limit":500,"offset":0,"sort":"company_rate","direction":"desc","filters":{"columns":{"job_no":["SORT-ONLY"]}}},
  {"limit":1,"offset":500,"sort":"company_rate","direction":"asc","filters":{"columns":{"job_no":["SORT-ONLY"]}}}
 ]'::jsonb else '[
  {"limit":100,"offset":0,"sort":"","direction":"asc","filters":{}},
  {"limit":1,"offset":1,"sort":"trip_date","direction":"desc","filters":{}},
  {"limit":500,"offset":0,"sort":"supplier_paid","direction":"desc","filters":{}},
  {"limit":100,"offset":0,"sort":"invoice_no","direction":"asc","filters":{}},
  {"limit":100,"offset":0,"sort":"supplier_invoice_no","direction":"desc","filters":{}},
  {"limit":100,"offset":0,"sort":"","direction":"asc","filters":{"search":"Entry"}},
  {"limit":100,"offset":0,"sort":"","direction":"asc","filters":{"columns":{"invoice_no":["?"]}}}
 ]'::jsonb end)
 loop
  actual:=public.transport_register_query((test_case->>'limit')::integer,(test_case->>'offset')::integer,test_case->'filters'||'{"use_cache":true,"refresh":true}'::jsonb,test_case->>'sort',test_case->>'direction');
  expected:=public.transport_register_query((test_case->>'limit')::integer,(test_case->>'offset')::integer,test_case->'filters',test_case->>'sort',test_case->>'direction');
  if actual-'rows_order'-'row_versions' is distinct from expected then raise exception 'Snapshot canonical parity failed: %',test_case;end if;
 end loop;
 if p_scale then return;end if;
 foreach header_key in array array['trip_no','trip_date','truck_type','job_no','from','to','driver','plate','owner','invoice_no','company','sale_type','charge','company_rate','received_company','remaining_company','customer_credit','supplier_invoice_no','supplier_charges','rent_driver','supplier_paid','supplier_balance','payment_date','amount','supplier_credit','commission','paper_received_by','profit'] loop
  actual:=public.transport_register_query(100,0,'{"use_cache":true}','','asc',header_key,'');
  expected:=public.transport_register_query(100,0,'{}','','asc',header_key,'');
  if actual-'permissions' is distinct from expected-'permissions' then raise exception 'Snapshot options differ: % actual=% expected=%',header_key,actual,expected;end if;
  foreach direction in array array['asc','desc'] loop
   actual:=public.transport_register_query(100,0,'{"use_cache":true}',header_key,direction);
   expected:=public.transport_register_query(100,0,'{}',header_key,direction);
   if actual-'rows_order'-'row_versions' is distinct from expected then raise exception 'Snapshot sort differs: % %',header_key,direction;end if;
  end loop;
 end loop;
 actual:=public.transport_register_query(100,0,'{"use_cache":true,"refresh":true}','','asc');
 expected:=public.transport_register_query(100,0,jsonb_build_object('use_cache',true,'refresh',true,'known_rows',actual->'row_versions'),'','asc');
 if expected->>'rows_delta'<>'true' or jsonb_array_length(expected->'rows')<>0
 or expected->'rows_order' is distinct from actual->'rows_order' then raise exception 'Unchanged Refresh retransmitted rows';end if;
 select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(actual->'rows');
 select jsonb_agg(to_jsonb(r) order by r.id) into before_rows from public._transport_register_snapshot_source(public.current_company_id(),public.current_business_unit_id(),public.current_operating_location_id(),ids) r;
 select jsonb_agg(to_jsonb(r) order by r.id) into after_rows from public.transport_financial_register r where r.id=any(ids);
 if before_rows is distinct from after_rows then raise exception 'Scoped canonical row/whole-invoice allocation mismatch';end if;
 if has_function_privilege('authenticated','public._transport_register_snapshot_source(uuid,uuid,uuid,uuid[])','execute')
 or has_table_privilege('authenticated','public.transport_register_snapshot_rows','select')
 or has_function_privilege('anon','public._transport_register_dirty_trips(uuid[])','execute')
 then raise exception 'Snapshot internal data access regression';end if;
 -- The subtransaction rolls back its synthetic edit and the cache update.
 begin
  target:=(actual->'rows'->0->>'id')::uuid;
  update public.transport_trips set notes=coalesce(notes,'')||' reader snapshot change' where id=target;
  expected:=public.transport_register_query(100,0,'{"use_cache":true}','','asc');
  if expected is distinct from actual then raise exception 'Sort/navigation unexpectedly refreshed saved snapshot';end if;
  expected:=public.transport_register_query(100,0,jsonb_build_object('use_cache',true,'refresh',true,'known_rows',actual->'row_versions'),'','asc');
  if jsonb_array_length(expected->'rows')<>1 or expected->'rows'->0->>'id'<>target::text
  then raise exception 'Refresh did not return exactly its changed Trip';end if;
  if (select count(*) from public.transport_register_dirty_rows where company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and permission_mask=3)<>0
  then raise exception 'Refresh left consumed dirty versions';end if;
  raise exception using errcode='PT502',message='Rollback synthetic cache edit';
 exception when sqlstate 'PT502' then null;end;
end $test$;
