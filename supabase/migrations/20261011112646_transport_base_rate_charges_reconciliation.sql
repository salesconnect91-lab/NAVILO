-- Base rates and charge lines are separate for Customer and Supplier.
-- No historical rows or posted accounting evidence are rewritten.
create or replace function public.transport_finalize_customer_rate(p_trip_id uuid,p_amount numeric,p_source text,p_reason text default null)
returns void language plpgsql security definer set search_path='public','pg_temp' as $function$
declare t public.transport_trips%rowtype;v_action text;v_charges numeric(18,2);v_total numeric(18,2);
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Transport Trip not found';end if;
 if public.transport_customer_side_posted(t.id) then raise exception 'Customer invoice is posted. Use Credit/Debit Note.';end if;
 v_action:=case when t.customer_rate_state='finalized' then 'customer_rate_override' else 'customer_rate_finalize' end;
 if not public.has_transport_action_permission(t.company_id,v_action) then raise exception 'Customer rate permission required';end if;
 if v_action='customer_rate_override' and nullif(btrim(p_reason),'') is null then raise exception 'Override reason required';end if;
 if p_amount is null or p_amount<0 or round(p_amount,2)<>p_amount or p_source not in ('agreed','manual') then raise exception 'Invalid customer base rate/source';end if;
 -- Input is BASE rate. Total = base + existing charges + explicit manual adjustment.
 select coalesce(sum(amount),0) into v_charges from public.transport_trip_customer_charges where trip_id=t.id;
 v_total:=round(p_amount+v_charges+coalesce(t.customer_manual_adjustment,0),2);
 if t.customer_rate_state='finalized' and t.customer_base_rate=p_amount and t.customer_rate=v_total and t.customer_rate_snapshot=v_total and t.customer_rate_source=p_source then return;end if;
 insert into public.transport_action_gate(transaction_id,trip_id,action) values(txid_current(),t.id,'customer_rate_finalize') on conflict do nothing;
 update public.transport_trips set customer_base_rate=p_amount,customer_rate=v_total,customer_rate_snapshot=v_total,customer_rate_state='finalized',
 customer_rate_source=p_source,customer_rate_reference_id=case when p_source='manual' then null else customer_rate_reference_id end,
 customer_rate_finalized_at=now(),customer_rate_finalized_by=auth.uid() where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='customer_rate_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,v_action,
 jsonb_build_object('base',t.customer_base_rate,'charges',v_charges,'total',t.customer_rate),
 jsonb_build_object('base',p_amount,'charges',v_charges,'total',v_total),p_reason,auth.uid());
end $function$;
revoke all on function public.transport_finalize_customer_rate(uuid,numeric,text,text) from public,anon;
grant execute on function public.transport_finalize_customer_rate(uuid,numeric,text,text) to authenticated;

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
 -- Legacy NULL base is derived from old total before replacing charge lines.
 base:=coalesce(t.customer_base_rate,
 greatest(0,t.customer_rate-coalesce((select sum(existing_line.amount) from public.transport_trip_customer_charges existing_line where existing_line.trip_id=t.id),0)-coalesce(t.customer_manual_adjustment,0)),0);
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
end$function$;
create or replace function public.transport_replace_trip_supplier_charges(p_rent_id uuid,p_lines jsonb,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
declare r public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;line jsonb;cm public.charge_master%rowtype;
 base numeric(18,2);charges numeric(18,2):=0;total numeric(18,2);seq int:=0;amt numeric(18,2);cmid uuid;old_lines jsonb;new_lines jsonb;
begin
 select * into r from public.transport_trip_supplier_rents where id=p_rent_id for update;
 if not found or r.company_id is distinct from public.current_company_id() or r.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Supplier rent not found in active workspace';end if;
 select * into t from public.transport_trips where id=r.trip_id for update;
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=r.id and not is_adjustment) then raise exception 'Supplier bill is posted. Supplier charges are locked; use controlled AP correction.';end if;
 if not public.has_transport_action_permission(r.company_id,case when r.state='finalized' then 'rent_correct' else 'rent_finalize' end) then raise exception 'Rent permission required';end if;
 if r.state='finalized' and nullif(btrim(p_reason),'') is null then raise exception 'Reason required when changing finalized supplier charges';end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))>50 then raise exception 'Charges must be an array of at most 50 lines';end if;
 -- A legacy NULL base is the pre-charge portion of the current amount.
 base:=coalesce(r.base_amount,greatest(0,r.amount-coalesce((select sum(amount) from public.transport_trip_supplier_charges where rent_id=r.id),0)),0);
 select coalesce(jsonb_agg(jsonb_build_object('charge_key',x.charge_key_snapshot,'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb) into old_lines from public.transport_trip_supplier_charges x where x.rent_id=r.id;
 delete from public.transport_trip_supplier_charges where rent_id=r.id;
 for line in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  seq:=seq+1;amt:=coalesce(nullif(line->>'amount','')::numeric,0);if amt<0 then raise exception 'Charge amount cannot be negative';end if;
  cmid:=coalesce(nullif(line->>'charge_master_id','')::uuid,nullif(line->>'charge_type_id','')::uuid);
  select * into cm from public.charge_master where id=cmid and company_id=r.company_id and is_active and applies_to in ('purchase','both');
  if not found then raise exception 'Selected Charge Master item is not active for Purchase';end if;
  if cm.cost_account_id is null then raise exception 'Charge % has no cost account mapping',cm.charge_name;end if;
  insert into public.transport_trip_supplier_charges(company_id,business_unit_id,trip_id,rent_id,charge_master_id,charge_key_snapshot,name_snapshot,amount,sort_order,created_by)
  values(r.company_id,r.business_unit_id,r.trip_id,r.id,cm.id,cm.charge_key,cm.charge_name,amt,seq,auth.uid());charges:=charges+amt;
 end loop;
 total:=round(base+charges,2);
 insert into public.transport_action_gate values(txid_current(),r.trip_id,'supplier_rent_finalize') on conflict do nothing;
 update public.transport_trip_supplier_rents set base_amount=base,amount=total,
 finalized_amount_snapshot=case when state='finalized' then total else finalized_amount_snapshot end,
 finalized_base_amount_snapshot=case when state='finalized' then base else finalized_base_amount_snapshot end
 where id=r.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=r.trip_id and action='supplier_rent_finalize';
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'charge_master_id',x.charge_master_id,'charge_type_id',x.charge_master_id,'code',x.charge_key_snapshot,'name',x.name_snapshot,'amount',x.amount) order by x.sort_order,x.id),'[]'::jsonb) into new_lines from public.transport_trip_supplier_charges x where x.rent_id=r.id;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(r.company_id,r.business_unit_id,r.trip_id,t.trip_no,'supplier_charges_changed',
 jsonb_build_object('base_rent',base,'charges',old_lines,'total_rent',r.amount),
 jsonb_build_object('base_rent',base,'charges',new_lines,'total_rent',total),p_reason,auth.uid());
 return jsonb_build_object('base_rent',base,'charges_total',charges,'total_rent',total,'lines',new_lines);
end$body$;
