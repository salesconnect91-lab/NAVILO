-- RLS does not apply to TRUNCATE. Client roles must never be able to truncate ERP tables.
revoke truncate on all tables in schema public from anon, authenticated;
