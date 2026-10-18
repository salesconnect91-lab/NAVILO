-- Eliminate the direct payment-reversal RPC bypass.
-- The authenticated API must use owner_cancel_unallocated_payment, which checks
-- owner permission, source voucher, FX, allocations, Transport links and mandatory audit.
-- SECURITY DEFINER wrapper retains owner-of-function execute privileges internally.
BEGIN;
REVOKE ALL ON FUNCTION public.reverse_payment_voucher(uuid,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_cancel_unallocated_payment(uuid,date,text) TO authenticated;
COMMIT;