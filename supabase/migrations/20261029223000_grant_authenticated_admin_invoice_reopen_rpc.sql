-- The existing function ACL was postgres-only. Allow signed-in callers to reach
-- the SECURITY DEFINER routine's internal authorization and dependency checks.
-- Anonymous and PUBLIC execution remain denied by the existing ACL.
GRANT EXECUTE ON FUNCTION public.admin_reopen_posted_invoice(text, uuid, text, date) TO authenticated;
