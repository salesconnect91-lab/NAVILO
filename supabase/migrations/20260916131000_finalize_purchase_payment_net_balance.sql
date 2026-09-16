-- pay_supplier historically performs a header update after inserting the
-- allocation.  The normal AFTER trigger recalculates the correct net balance
-- first, so that later update can overwrite it with a gross (pre-debit-note)
-- balance.  Re-run the canonical calculation at transaction end, after the
-- RPC has finished all of its statements.

drop trigger if exists trg_finalize_purchase_payment_status
  on public.purchase_payment_allocations;

create constraint trigger trg_finalize_purchase_payment_status
after insert or update or delete on public.purchase_payment_allocations
deferrable initially deferred
for each row
execute function public.recalculate_purchase_order_payment_status();
