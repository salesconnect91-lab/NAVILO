-- Reduce unnecessary RPC exposure for trigger-only functions.
-- Trigger execution does not require callers to have direct EXECUTE privileges;
-- only trusted migration/administrative roles need permission to create/replace triggers.
REVOKE ALL ON FUNCTION public.prevent_posted_return_note_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_posted_return_note_line_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transport_guard_duplicate_invoice_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transport_guard_duplicate_supplier_reference() FROM PUBLIC, anon, authenticated;

-- Keep trigger-only helper functions non-callable through the public API.
REVOKE ALL ON FUNCTION public.assign_return_note_number_yearwise() FROM PUBLIC, anon, authenticated;
