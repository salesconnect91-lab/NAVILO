-- Forward-only: enforce posted customer-side immutability at the canonical rate RPC.
CREATE OR REPLACE FUNCTION public.transport_finalize_customer_rate(p_trip_id uuid, p_amount numeric, p_source text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype; v_action text;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport Trip not found'; end if;
 if public.transport_customer_side_posted(t.id) then raise exception 'Customer invoice is posted. Customer rate is locked; use Credit/Debit Note or controlled correction.'; end if;
 v_action:=case when t.customer_rate_state='finalized' then 'customer_rate_override' else 'customer_rate_finalize' end;
 if not public.has_transport_action_permission(t.company_id,v_action) then raise exception 'Customer rate permission required'; end if;
 if v_action='customer_rate_override' and nullif(btrim(p_reason),'') is null then raise exception 'Override reason required'; end if;
 if p_amount is null or p_amount<0 or p_source not in ('agreed','manual') then raise exception 'Invalid customer rate/source'; end if;
 if t.customer_rate_state='finalized' and t.customer_rate=p_amount and t.customer_rate_snapshot=p_amount and t.customer_rate_source=p_source then return;end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'customer_rate_finalize');
 update public.transport_trips set customer_rate=p_amount,customer_rate_snapshot=p_amount,customer_rate_state='finalized',
  customer_rate_source=p_source,customer_rate_finalized_at=now(),customer_rate_finalized_by=auth.uid() where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='customer_rate_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,v_action,to_jsonb(t.customer_rate),to_jsonb(p_amount),p_reason,auth.uid());
end $function$
;
