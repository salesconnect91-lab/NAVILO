BEGIN;
-- The Sales and Purchase invoice detail screens call this SECURITY DEFINER RPC
-- directly. It must be callable by a signed-in user so its internal owner/admin
-- authorization and dependency checks can run; it must never be public/anonymous.
REVOKE ALL ON FUNCTION public.admin_reopen_posted_invoice(text, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reopen_posted_invoice(text, uuid, text, date) TO authenticated;
COMMIT;