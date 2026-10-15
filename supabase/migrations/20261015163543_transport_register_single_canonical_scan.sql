-- Keep one canonical financial projection. The opening and financial branches
-- previously scanned the same workspace twice and hid date predicates behind
-- a PL/pgSQL function boundary. The financial view already includes opening
-- balances, including unconverted Trips. No financial records are changed.
-- SECURITY INVOKER and existing EXECUTE privileges are preserved. With no SET
-- clauses, PostgreSQL can inline this SQL reader and push date filters down.
create or replace function public._transport_linked_register_source(
  p_company uuid,p_unit uuid,p_location uuid
) returns setof public.transport_financial_register
language sql stable security invoker rows 20000
as $body$
  select fr.*
  from public.transport_financial_register fr
  join public.transport_trips t on t.id=fr.id
  where t.company_id=p_company and t.business_unit_id=p_unit
    and t.operating_location_id=p_location
$body$;

notify pgrst,'reload schema';
