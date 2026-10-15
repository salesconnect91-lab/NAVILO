-- Read-only regression checks for transport_register_driver_order_page.
-- Run under an authenticated Transport user with active workspace.
-- No writes or production financial mutations.
DO $$
DECLARE
  n bigint;
  mismatch bigint;
BEGIN
  select count(*), count(*) - count(distinct id)
  into n, mismatch
  from public.transport_register_driver_order_page(100,0,'desc');
  if n < 1 or mismatch <> 0 then
    raise exception 'Driver page must have unique IDs and nonempty result';
  end if;
  -- Compare labels against the authoritative financial view for just this page.
  -- This test may be expensive until page-level financial pushdown is implemented.
  with chosen as materialized (
    select * from public.transport_register_driver_order_page(100,0,'desc')
  )
  select count(*) into mismatch
  from chosen c
  left join public.transport_financial_register f on f.id=c.id
  where f.id is null or f.driver_name is distinct from c.driver_name;
  if mismatch > 0 then
    raise exception 'Driver label parity failed for % rows', mismatch;
  end if;
END $$;
