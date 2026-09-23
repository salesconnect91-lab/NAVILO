-- Restore stock movement audit columns required by later MIS/report migrations.
alter table public.stock_movements
  add column if not exists adjustment_action text,
  add column if not exists reason_code text,
  add column if not exists approved_by_employee_id uuid,
  add column if not exists approved_by_name text,
  add column if not exists entered_by_name text,
  add column if not exists previous_qty numeric,
  add column if not exists resulting_qty numeric;
