/*
# Steel Mill ERP — Gate Pass, Weighbridge & Auto-Posting Schema

Adds gate pass/weighbridge tickets, party ledgers for customer/supplier balances,
charge columns on purchase orders, "posted" status on sales & purchase orders,
and godown reference on stock movements.

## 1. Modified Tables

### sales_orders
- Add `posted` status to the status CHECK constraint (now: draft, confirmed, shipped, closed, posted)
- Add `unloading_charge`, `labour_charge`, `handling_charge` numeric columns (default 0)

### purchase_orders
- Add `loading_charge`, `unloading_charge`, `cutting_charge`, `transport_charge`, `labour_charge`, `handling_charge`, `other_charge` numeric columns (default 0)
- Add `posted` status to the status CHECK constraint (now: draft, confirmed, received, closed, posted)

### stock_movements
- Add `godown` text column (default 'Main') — which warehouse the movement affects

## 2. New Tables

### gate_passes
- Weighbridge / gate pass tickets for truck loading/unloading
- `id`, `user_id`, `pass_no`, `sales_order_id` (FK to sales_orders), `type` ('loading'/'unloading'),
  `godown`, `vehicle_no`, `driver_name`, `tare_weight`, `gross_weight`, `net_weight` (auto-calc),
  `labour_contractor`, `status` ('pending'/'completed'/'cancelled'), `pass_date`, `created_at`

### party_ledgers
- Running balance ledger for customers and suppliers
- `id`, `user_id`, `party_type` ('customer'/'supplier'), `party_id` (uuid, no FK — stores customer or supplier id),
  `entry_date`, `description`, `reference`, `debit`, `credit`, `balance`, `created_at`

## 3. Security
- RLS enabled on all new tables.
- Owner-scoped CRUD policies (4 per table, TO authenticated).
- All owner columns default to auth.uid().
- All statements use IF NOT EXISTS / idempotent patterns.

## 4. Notes
- The status CHECK constraints are replaced via DROP CONSTRAINT + ADD CONSTRAINT to add 'posted'.
- No data is lost — existing rows keep their current status values.
*/

-- ============================================================
-- MODIFY sales_orders: add posted status + new charge columns
-- ============================================================

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS unloading_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS labour_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS handling_charge numeric(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;
  ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN ('draft','confirmed','shipped','closed','posted'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- MODIFY purchase_orders: add charge columns + posted status
-- ============================================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS loading_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS unloading_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cutting_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS transport_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS labour_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS handling_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS other_charge numeric(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
  ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
    CHECK (status IN ('draft','confirmed','received','closed','posted'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- MODIFY stock_movements: add godown column
-- ============================================================

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS godown text NOT NULL DEFAULT 'Main';

-- ============================================================
-- NEW TABLE: gate_passes
-- ============================================================

CREATE TABLE IF NOT EXISTS gate_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  pass_no text NOT NULL,
  sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'loading' CHECK (type IN ('loading','unloading')),
  godown text NOT NULL DEFAULT 'Main',
  vehicle_no text,
  driver_name text,
  tare_weight numeric(14,2) NOT NULL DEFAULT 0,
  gross_weight numeric(14,2) NOT NULL DEFAULT 0,
  net_weight numeric(14,2) NOT NULL DEFAULT 0,
  labour_contractor text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  pass_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gate_passes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_gate_passes_user ON gate_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_gate_passes_sales_order ON gate_passes(sales_order_id);

-- ============================================================
-- NEW TABLE: party_ledgers
-- ============================================================

CREATE TABLE IF NOT EXISTS party_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  reference text,
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE party_ledgers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_party_ledgers_user ON party_ledgers(user_id);
CREATE INDEX IF NOT EXISTS idx_party_ledgers_party ON party_ledgers(party_id);
CREATE INDEX IF NOT EXISTS idx_party_ledgers_type ON party_ledgers(party_type);

-- ============================================================
-- RLS POLICIES FOR NEW TABLES
-- ============================================================

-- gate_passes
DROP POLICY IF EXISTS "select_own_gate_passes" ON gate_passes;
CREATE POLICY "select_own_gate_passes" ON gate_passes FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_gate_passes" ON gate_passes;
CREATE POLICY "insert_own_gate_passes" ON gate_passes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_gate_passes" ON gate_passes;
CREATE POLICY "update_own_gate_passes" ON gate_passes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_gate_passes" ON gate_passes;
CREATE POLICY "delete_own_gate_passes" ON gate_passes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- party_ledgers
DROP POLICY IF EXISTS "select_own_party_ledgers" ON party_ledgers;
CREATE POLICY "select_own_party_ledgers" ON party_ledgers FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_party_ledgers" ON party_ledgers;
CREATE POLICY "insert_own_party_ledgers" ON party_ledgers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_party_ledgers" ON party_ledgers;
CREATE POLICY "update_own_party_ledgers" ON party_ledgers FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_party_ledgers" ON party_ledgers;
CREATE POLICY "delete_own_party_ledgers" ON party_ledgers FOR DELETE TO authenticated USING (auth.uid() = user_id);
