-- Forward-only correction: disambiguate the SQL alias from the cm record variable.
CREATE OR REPLACE FUNCTION public.transport_replace_trip_customer_charges(p_trip_id uuid, p_lines jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;line jsonb;cm public.charge_master%rowtype;
 base numeric(18,2);total_charges numeric(18,2):=0;final_rate numeric(18,2);seq int:=0;amount numeric(18,2);old_lines jsonb;new_lines jsonb;cmid uuid;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Transport Trip not found in active workspace'; end if;
 if not public.has_transport_action_permission(t.company_id,case when t.customer_rate_state='finalized' then 'customer_rate_override' else 'customer_rate_finalize' end) then raise exception 'Customer rate permission required'; end if;
 if public.transport_customer_side_posted(t.id) then raise exception 'Customer invoice is posted. Customer-side Trip data and charges are locked; use Credit/Debit Note.'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))>50 then raise exception 'Charges must be an array of at most 50 lines'; end if;
 if t.customer_rate_state='finalized' and nullif(btrim(p_reason),'') is null then raise exception 'Reason required when changing a finalized unposted customer rate'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('charge_key',coalesce(charge_row.charge_key,x.code_snapshot),'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb)
 into old_lines from public.transport_trip_customer_charges x left join public.charge_master charge_row on charge_row.id=x.charge_master_id where x.trip_id=t.id;
 base:=coalesce(t.customer_base_rate,t.customer_rate,0);
 delete from public.transport_trip_customer_charges where trip_id=t.id;
 for line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  seq:=seq+1; amount:=coalesce(nullif(line->>'amount','')::numeric,0);
  if amount<0 then raise exception 'Charge amount cannot be negative';end if;
  cmid:=coalesce(nullif(line->>'charge_master_id','')::uuid,nullif(line->>'charge_type_id','')::uuid);
  select * into cm from public.charge_master where id=cmid and company_id=t.company_id and is_active and applies_to in ('sales','both');
  if not found then raise exception 'Selected Charge Master item is not active for Sales';end if;
  if cm.revenue_account_id is null then raise exception 'Charge % has no revenue account mapping',cm.charge_name;end if;
  insert into public.transport_trip_customer_charges(company_id,business_unit_id,trip_id,charge_type_id,charge_master_id,code_snapshot,name_snapshot,amount,sort_order,created_by)
  values(t.company_id,t.business_unit_id,t.id,null,cm.id,cm.charge_key,cm.charge_name,amount,seq,auth.uid());
  total_charges:=total_charges+amount;
 end loop;
 final_rate:=round((base+total_charges+coalesce(t.customer_manual_adjustment,0))::numeric,2);
 insert into public.transport_action_gate values(txid_current(),t.id,'customer_rate_finalize') on conflict do nothing;
 update public.transport_trips set customer_base_rate=base,customer_rate=final_rate,
 customer_rate_snapshot=case when customer_rate_state='finalized' then final_rate else customer_rate_snapshot end,
 customer_rate_source=case when customer_rate_state='finalized' then 'manual' else customer_rate_source end,
 updated_at=now(),updated_by=auth.uid() where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='customer_rate_finalize';
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'charge_master_id',x.charge_master_id,'charge_type_id',x.charge_master_id,'code',x.code_snapshot,'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb)
 into new_lines from public.transport_trip_customer_charges x where x.trip_id=t.id;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,'customer_charges_changed',
 jsonb_build_object('base_rate',coalesce(t.customer_base_rate,base),'charges',old_lines,'final_rate',t.customer_rate),
 jsonb_build_object('base_rate',base,'charges',new_lines,'final_rate',final_rate),p_reason,auth.uid());
 return jsonb_build_object('base_rate',base,'charges_total',total_charges,'manual_adjustment',coalesce(t.customer_manual_adjustment,0),'final_rate',final_rate,'lines',new_lines);
end$function$

