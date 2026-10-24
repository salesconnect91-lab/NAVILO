-- Supports date-range filters and newest-first paging on the large audit log table.
CREATE INDEX IF NOT EXISTS audit_logs_created_at_id_desc_idx
  ON public.audit_logs (created_at DESC, id DESC);
