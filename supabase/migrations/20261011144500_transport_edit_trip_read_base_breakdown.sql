-- Extend the scoped Trip editor with separate base/charge snapshots.
create or replace function public.transport_edit_trip_read(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path='public','pg_temp'
as $function$
declare t public.transport_trips%rowtype;answer jsonb;cnt int;rid uuid;rent_total numeric;rent_base numeric;
begin
 if not public.has_module_permission(public.current_company_id(),'transport','view') then raise exception 'Transport view permission required';end if;
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id();
 if not found then raise exception 'Trip not found in workspace';end if;
 answer:=public.transport_mask_financial_row(to_jsonb(t));
 if public.transport_financial_read_allowed('customer') then
  answer:=answer||jsonb_build_object('customer_charges_total',
   (select coalesce(sum(amount),0) from public.transport_trip_customer_charges where trip_id=t.id));
 end if;
 if public.transport_financial_read_allowed('supplier') then
  select count(*),min(id),sum(coalesce(finalized_amount_snapshot,amount)) into cnt,rid,rent_total
  from public.transport_trip_supplier_rents where trip_id=t.id;
  answer:=answer||jsonb_build_object('supplier_rent_total',rent_total,'supplier_rent_count',cnt);
  if cnt=1 then
   select coalesce(r.base_amount,greatest(0,r.amount-coalesce((select sum(amount) from public.transport_trip_supplier_charges where rent_id=rid),0)))
   into rent_base from public.transport_trip_supplier_rents r where r.id=rid;
   answer:=answer||jsonb_build_object('supplier_rent_id',rid,'supplier_base_rate',rent_base,'supplier_charges_total',
   (select coalesce(sum(amount),0) from public.transport_trip_supplier_charges where rent_id=rid));
  end if;
 end if;
 return answer;
end $function$;
revoke all on function public.transport_edit_trip_read(uuid) from public,anon;
grant execute on function public.transport_edit_trip_read(uuid) to authenticated;
