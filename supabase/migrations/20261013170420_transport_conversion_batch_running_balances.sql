begin;
create table public.transport_conversion_balance_queue(
 transaction_id bigint not null,actor_id uuid not null,company_id uuid not null,user_id uuid not null,business_unit_id uuid not null,party_type text not null,party_id uuid not null,
 primary key(transaction_id,actor_id,company_id,user_id,business_unit_id,party_type,party_id));
alter table public.transport_conversion_balance_queue enable row level security;
revoke all on public.transport_conversion_balance_queue from public,anon,authenticated;
do $patch$
declare f text;gate text;flush text;
begin
 if to_regprocedure('public.recalculate_party_ledger_balance()') is null then
 execute $base$create function public.recalculate_party_ledger_balance() returns trigger language plpgsql set search_path=public,pg_temp as $body$
 declare v_party_type text;v_party_id uuid;v_user_id uuid;v_unit uuid;
 begin
 if tg_op='DELETE' then v_party_type:=old.party_type;v_party_id:=old.party_id;v_user_id:=old.user_id;v_unit:=old.business_unit_id;
 else v_party_type:=new.party_type;v_party_id:=new.party_id;v_user_id:=new.user_id;v_unit:=new.business_unit_id;end if;
 with running as (select id,sum(debit-credit) over(partition by user_id,business_unit_id,party_type,party_id order by entry_date,created_at,id rows between unbounded preceding and current row) running_balance from public.party_ledgers where user_id=v_user_id and business_unit_id=v_unit and party_type=v_party_type and party_id=v_party_id)
 update public.party_ledgers pl set balance=running.running_balance from running where pl.id=running.id and pl.balance is distinct from running.running_balance;
 return coalesce(new,old);
 end $body$ $base$;
 execute 'create trigger trg_recalculate_party_ledger_balance after insert or delete or update of debit,credit,entry_date,party_id,party_type on public.party_ledgers for each row execute function public.recalculate_party_ledger_balance()';
 end if;
 f:=pg_get_functiondef('public.recalculate_party_ledger_balance()'::regprocedure);
 gate:=$gate$
 if tg_op='INSERT' and exists(
 select 1 from public.transport_register_conversion_gates g
 join public.transport_register_invoice_conversions v on v.document_id=g.document_id
 join public.journal_entries j on j.id=new.journal_entry_id
 where g.transaction_id=txid_current() and g.actor_id=auth.uid()
 and v.company_id=new.company_id and v.business_unit_id=new.business_unit_id
 and v.operating_location_id=new.operating_location_id
 and public.transport_register_conversion_allowed(g.order_id,g.side)
 and (j.source_document_id=v.order_id or j.source_document_id=v.document_id)
 and j.source_document_type in('sales_invoice','purchase_invoice','transport_historical_clearing','transport_opening_invoice_reclassification')
 ) then
 insert into public.transport_conversion_balance_queue values(txid_current(),auth.uid(),new.company_id,new.user_id,new.business_unit_id,new.party_type,new.party_id) on conflict do nothing;
 return new;
 end if;
$gate$;
 f:=regexp_replace(f,'\mbegin\M','begin'||gate,'i');execute f;
 f:=pg_get_functiondef('public.transport_convert_register_invoice_batch(text,integer,boolean)'::regprocedure);
 flush:=$flush$
 with running as (
 select pl.id,sum(pl.debit-pl.credit) over(partition by pl.user_id,pl.business_unit_id,pl.party_type,pl.party_id order by pl.entry_date,pl.created_at,pl.id rows between unbounded preceding and current row) running_balance
 from public.party_ledgers pl
 join public.transport_conversion_balance_queue q on q.transaction_id=txid_current() and q.actor_id=auth.uid()
 and q.company_id=c and q.business_unit_id=b and q.company_id=pl.company_id
 and q.user_id=pl.user_id and q.business_unit_id=pl.business_unit_id and q.party_type=pl.party_type and q.party_id=pl.party_id
 ) update public.party_ledgers pl set balance=running.running_balance from running where pl.id=running.id and pl.balance is distinct from running.running_balance;
 delete from public.transport_conversion_balance_queue where transaction_id=txid_current() and actor_id=auth.uid() and company_id=c and business_unit_id=b;
$flush$;
 if strpos(f,'return jsonb_build_object(')=0 then raise exception 'Expected batch completion missing';end if;
 execute replace(f,'return jsonb_build_object(',flush||'return jsonb_build_object(');
end $patch$;
commit;
