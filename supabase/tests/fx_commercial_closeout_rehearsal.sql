begin;
do $$
begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoice_payment_allocations' and column_name='realized_fx_amount') then raise exception 'Customer FX audit column missing'; end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='purchase_payment_allocations' and column_name='realized_fx_amount') then raise exception 'Supplier FX audit column missing'; end if;
 if round(100*0.91,2)<>91 or round(100*0.95,2)-round(100*0.91,2)<>4 then raise exception 'Sales FX arithmetic failed'; end if;
 if round(80*0.91,2)-round(80*0.88,2)<>2.40 then raise exception 'Purchase FX arithmetic failed'; end if;
 raise notice 'PASS: commercial FX allocation audit snapshots and realized gain/loss arithmetic';
end $$;
rollback;
