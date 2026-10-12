-- Production-applied 20261012200006.
-- Register RPC's materialized aggregate reads were spilling heavily to temporary disk.
-- Scope additional memory to this function only; never change global work_mem.
-- Financial arithmetic, filters, security grants, rows and postings remain unchanged.
ALTER FUNCTION public.transport_register_query(integer,integer,jsonb,text,text,text,text)
  SET work_mem = '16MB';
