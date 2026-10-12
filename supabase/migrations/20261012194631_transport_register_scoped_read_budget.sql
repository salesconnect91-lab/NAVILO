-- Production-applied: bounded timeout for the Transport Register read RPC only.
-- Preserve all calculations, privileges, company scope, row data and postings.
-- This is a temporary mitigation, not a substitute for SQL-plan optimization.
ALTER FUNCTION public.transport_register_query(integer,integer,jsonb,text,text,text,text)
  SET statement_timeout = '15s';
