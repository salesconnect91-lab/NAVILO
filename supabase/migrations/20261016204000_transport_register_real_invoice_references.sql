-- Display authentic source invoice numbers before canonical generated accounting references.
-- Preserve every posted invoice, purchase, payment, journal, Trip number and row.
-- If no real source reference exists, generated H-S/H-P numbers are not displayed.
CREATE OR REPLACE FUNCTION public._transport_register_snapshot_fill(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
 declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 cv boolean:=public.transport_financial_read_allowed('customer');sv boolean:=public.transport_financial_read_allowed('supplier');
 mask smallint:=(case when cv then 1 else 0 end)+(case when sv then 2 else 0 end);
 p_filters jsonb:='{}';needs_cells boolean:=true;needs_text_cells boolean:=true;needs_invoice_cells boolean:=true;
 begin
  with register_source as materialized (
  select linked.* from public._transport_register_snapshot_source(c,b,loc,p_ids) linked
  where (coalesce(p_filters->>'fromDate','')='' or linked.trip_date>=(p_filters->>'fromDate')::date)
    and (coalesce(p_filters->>'toDate','')='' or linked.trip_date<=(p_filters->>'toDate')::date)
), agreed_rents as not materialized (
  select trip_id,sum(coalesce(finalized_amount_snapshot,amount)) amount
  from public.transport_trip_supplier_rents
  where company_id=c and business_unit_id=b group by trip_id
 ),
 customer_charge_agg as not materialized (
  select trip_id,sum(amount) amount
  from public.transport_trip_customer_charges
  where company_id=c and business_unit_id=b group by trip_id
 ),
 supplier_charge_agg as not materialized (
  select trip_id,sum(amount) amount,
         string_agg(charge_key_snapshot,' + ' order by sort_order,id) charge_names
  from public.transport_trip_supplier_charges
  where company_id=c and business_unit_id=b group by trip_id
 ),
 customer_invoice_agg as not materialized (
  select distinct on (l.trip_id) l.trip_id,s.order_no
  from public.transport_customer_document_trips l
  join public.transport_customer_documents d on d.id=l.document_id
  join public.sales_orders s on s.id=d.sales_order_id
  where cv and needs_invoice_cells and not l.is_adjustment
  order by l.trip_id,l.id
 ),
 supplier_invoice_agg as not materialized (
  select r.trip_id,
         string_agg(distinct p.order_no, ', ' order by p.order_no) order_nos
  from public.transport_trip_supplier_rents r
  join public.transport_supplier_document_rents l on l.rent_id=r.id and not l.is_adjustment
  join public.transport_supplier_documents d on d.id=l.document_id
  join public.purchase_orders p on p.id=d.purchase_order_id
  join public.transport_active_journals j on j.id=d.journal_entry_id
  where sv and needs_invoice_cells and r.company_id=c and r.business_unit_id=b
  group by r.trip_id
 ),
 supplier_status_agg as not materialized (
  select r.trip_id,
         count(*) rent_count,
         bool_and(r.state='finalized') all_finalized,
         bool_and(exists(
           select 1
           from public.transport_supplier_document_rents l
           join public.transport_supplier_documents d on d.id=l.document_id
           join public.transport_active_journals j on j.id=d.journal_entry_id
           where l.rent_id=r.id and not l.is_adjustment
         )) all_posted
  from public.transport_trip_supplier_rents r
  where r.company_id=c and r.business_unit_id=b
  group by r.trip_id
 ), scoped as materialized (
  select r.id,r.trip_date,r.payment_date,r.trip_no,to_jsonb(r) full_row,
  case
   when coalesce(r.customer_rate_locked,false)
    and ((coalesce(r.owner_rent,0)>0 or coalesce(ssa.rent_count,0)>0) and coalesce(r.supplier_rate_locked,false) and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_posted,false) else true end)
    and coalesce(r.customer_outstanding_gross,0)<=0.005 and coalesce(r.supplier_outstanding_gross,0)<=0.005 then 'settled'
   when coalesce(r.customer_rate_locked,false)
    and ((coalesce(r.owner_rent,0)>0 or coalesce(ssa.rent_count,0)>0) and coalesce(r.supplier_rate_locked,false) and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_posted,false) else true end) then 'locked'
   when coalesce(r.customer_rate_state,'pending')='finalized'
    and case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_finalized,false) else coalesce(r.rent_state,'pending')='finalized' end then 'complete'
   when coalesce(r.customer_rate_state,'pending')='finalized'
    or case when coalesce(ssa.rent_count,0)>0 then coalesce(ssa.all_finalized,false) else coalesce(r.rent_state,'pending')='finalized' end then 'incomplete'
   else 'draft'
  end status,
  r.financial_status,r.ppr_status,r.customer_name,r.driver_name,r.vehicle_no,r.po_do_job_no,r.from_location,r.to_location,case when cv then coalesce(cca.amount,0) else 0 end n_customer_charges,(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end) n_rent_driver,case when sv then coalesce(sca.amount,0) else 0 end n_supplier_charges,coalesce(r.payment_amount,0) n_supplier_paid,greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0) n_supplier_balance,greatest(coalesce(r.supplier_credit_gross,0),0) n_supplier_credit,coalesce(r.driver_accrued,r.driver_pay,0) n_driver_pay,coalesce(r.driver_paid,0) n_driver_paid,coalesce(r.driver_outstanding,0) n_driver_balance,coalesce(r.payment_amount,0) n_amount,coalesce(r.billed_customer_net,r.customer_rate,0) n_company_rate,coalesce(r.customer_received_gross,0) n_received_company,greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0) n_remaining_company,greatest(coalesce(r.customer_credit_gross,0),0) n_customer_credit,(coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)) n_profit,coalesce(r.commission_paid_net,0) n_commission,case when cv then coalesce(nullif(btrim(r.historical_customer_invoice_ref),''),case when cia.order_no like 'H-S-%' then null else cia.order_no end) end invoice_no_raw,case when sv then coalesce(nullif(btrim(r.historical_supplier_invoice_ref),''),case when sia.order_nos like 'H-P-%' then null else sia.order_nos end) end supplier_invoice_no_raw,jsonb_build_object('cells',case when needs_text_cells then jsonb_build_object(
'trip_no',coalesce(nullif(r.trip_no,''),'?'),
'source_trip_id',coalesce(nullif((select bt.transport_source_trip_id from public.transport_trips bt where bt.id=r.id),''),nullif(substring(r.notes from 'Legacy CSV Trip ([0-9]+)'),''),'?'),
'trip_date',coalesce(nullif(to_char(r.trip_date,'DD-Mon-YY'),''),'?'),
'truck_type',coalesce(nullif(r.truck_type_name,''),'?'),
'job_no',coalesce(nullif(r.po_do_job_no,''),'?'),
'invoiced',coalesce(nullif(case when r.invoiced then 'Yes' else 'No' end,''),'?'),
'company',coalesce(nullif(r.customer_name,''),'?'),
'driver',coalesce(nullif(r.driver_name,''),'?'),
'owner',coalesce(nullif(r.owner_name,''),'?'),
'plate',coalesce(nullif(r.vehicle_no,''),'?'),
'from',coalesce(nullif(r.from_location,''),'?'),
'to',coalesce(nullif(r.to_location,''),'?'),
'charge',to_char(case when cv then coalesce(cca.amount,0) else 0 end,'FM999,999,999,999,999,990.00'),
'supplier_charge',case when sv then coalesce(nullif(sca.charge_names,''),'?') else '?' end,
'paper_received_by',coalesce(nullif(case when r.ppr_status='received' then coalesce(nullif(coalesce((select pc.corrected_name from public.transport_ppr_receiver_corrections pc where pc.trip_id=r.id and pc.company_id=c and pc.business_unit_id=b),r.ppr_received_by_name),''),'—')||coalesce(' · '||to_char(r.ppr_received_date,'DD-Mon-YY'),'') else 'Pending' end,''),'?'),
'payment_date',coalesce(nullif(to_char(r.payment_date,'DD-Mon-YY'),''),'?'),
'invoice_no',coalesce(nullif(case when cv then coalesce(nullif(btrim(r.historical_customer_invoice_ref),''),case when cia.order_no like 'H-S-%' then null else cia.order_no end) end,''),'?'),
'supplier_invoice_no',coalesce(nullif(case when sv then coalesce(nullif(btrim(r.historical_supplier_invoice_ref),''),case when sia.order_nos like 'H-P-%' then null else sia.order_nos end) end,''),'?'),
'sale_type',coalesce(nullif(r.sale_type,''),'?'),
'rent_driver',to_char((coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end),'FM999,999,999,999,999,990.00'),
'supplier_charges',to_char(case when sv then coalesce(sca.amount,0) else 0 end,'FM999,999,999,999,999,990.00'),
'supplier_paid',to_char(coalesce(r.payment_amount,0),'FM999,999,999,999,999,990.00'),
'supplier_balance',to_char(greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0),'FM999,999,999,999,999,990.00'),
'supplier_credit',to_char(greatest(coalesce(r.supplier_credit_gross,0),0),'FM999,999,999,999,999,990.00'),
'driver_pay',to_char(coalesce(r.driver_accrued,r.driver_pay,0),'FM999,999,999,999,999,990.00'),
'driver_paid',to_char(coalesce(r.driver_paid,0),'FM999,999,999,999,999,990.00'),
'driver_balance',to_char(coalesce(r.driver_outstanding,0),'FM999,999,999,999,999,990.00'),
'amount',to_char(coalesce(r.payment_amount,0),'FM999,999,999,999,999,990.00'),
'company_rate',to_char(coalesce(r.billed_customer_net,r.customer_rate,0),'FM999,999,999,999,999,990.00'),
'received_company',to_char(coalesce(r.customer_received_gross,0),'FM999,999,999,999,999,990.00'),
'remaining_company',to_char(greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0),'FM999,999,999,999,999,990.00'),
'customer_credit',to_char(greatest(coalesce(r.customer_credit_gross,0),0),'FM999,999,999,999,999,990.00'),
'profit',to_char((coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)),'FM999,999,999,999,999,990.00'),
'commission',to_char(coalesce(r.commission_paid_net,0),'FM999,999,999,999,999,990.00')) else '{}'::jsonb end, 'numbers',case when needs_cells then jsonb_build_object(
'charge',case when cv then coalesce(cca.amount,0) else 0 end,
'rent_driver',(coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end),
'supplier_charges',case when sv then coalesce(sca.amount,0) else 0 end,
'supplier_paid',coalesce(r.payment_amount,0),
'supplier_balance',greatest(coalesce(r.supplier_outstanding_gross,r.remaining_with_us,0),0),
'supplier_credit',greatest(coalesce(r.supplier_credit_gross,0),0),
'driver_pay',coalesce(r.driver_accrued,r.driver_pay,0),
'driver_paid',coalesce(r.driver_paid,0),
'driver_balance',coalesce(r.driver_outstanding,0),
'amount',coalesce(r.payment_amount,0),
'company_rate',coalesce(r.billed_customer_net,r.customer_rate,0),
'received_company',coalesce(r.customer_received_gross,0),
'remaining_company',greatest(coalesce(r.customer_outstanding_gross,r.remaining_with_company,0),0),
'customer_credit',greatest(coalesce(r.customer_credit_gross,0),0),
'profit',(coalesce(r.billed_customer_net,r.customer_rate,0)
 - (coalesce(r.billed_supplier_net,case when sv then ar.amount end,r.supplier_rent,r.owner_rent,0)+case when sv then coalesce(r.historical_company_cost_net,0) else 0 end)
 - greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
 - coalesce(r.other_cost_net,0)),
'commission',coalesce(r.commission_paid_net,0)) || case when r.trip_no ~ '^[0-9]+$' then jsonb_build_object('trip_no',r.trip_no::numeric) else '{}'::jsonb end else '{}'::jsonb end) vals from (select fr.* from register_source fr where cv and sv union all select masked.* from register_source fr cross join lateral jsonb_populate_record(null::public.transport_financial_register,public._transport_mask_financial_row(to_jsonb(fr),cv,sv)) masked where not (cv and sv)) r join public.transport_trips register_identity on register_identity.id=r.id left join agreed_rents ar on ar.trip_id=register_identity.id
    left join customer_charge_agg cca on cca.trip_id=register_identity.id
    left join supplier_charge_agg sca on sca.trip_id=register_identity.id
    left join customer_invoice_agg cia on cia.trip_id=register_identity.id
    left join supplier_invoice_agg sia on sia.trip_id=register_identity.id
    left join supplier_status_agg ssa on ssa.trip_id=register_identity.id
  where true
   and (coalesce(p_filters->>'fromDate','')='' or r.trip_date>=(p_filters->>'fromDate')::date)
   and (coalesce(p_filters->>'toDate','')='' or r.trip_date<=(p_filters->>'toDate')::date)
   and (coalesce(p_filters->>'customer','')='' or r.customer_name=p_filters->>'customer')
   and (coalesce(p_filters->>'driver','')='' or r.driver_name=p_filters->>'driver')
   and (coalesce(p_filters->>'vehicle','')='' or r.vehicle_no=p_filters->>'vehicle')
   and (coalesce(p_filters->>'from','')='' or r.from_location=p_filters->>'from')
   and (coalesce(p_filters->>'to','')='' or r.to_location=p_filters->>'to')
   and (coalesce(p_filters->>'ppr','')='' or r.ppr_status=p_filters->>'ppr')
 )
 insert into public.transport_register_snapshot_rows(company_id,business_unit_id,operating_location_id,permission_mask,trip_id,data)
 select c,b,loc,mask,x.id,to_jsonb(x) from scoped x
 on conflict(company_id,business_unit_id,operating_location_id,permission_mask,trip_id)
 do update set data=excluded.data;
 end $function$;
