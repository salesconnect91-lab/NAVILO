/*
# Steel Mill ERP — Schema Extension

Extends the existing ERP schema with steel-mill-specific columns and new tables.

## 1. Modified Tables

### items
- Add `grade` (text) — steel grade (e.g. Fe500D, IS2062 E250)
- Add `size` (text) — bar size / section (e.g. 12mm, 16mm, 25x25)

### sales_orders
- Add `sales_person` (text) — name of the sales person
- Add `loading_charge` (numeric, default 0)
- Add `cutting_charge` (numeric, default 0)
- Add `transport_charge` (numeric, default 0)
- Add `other_charge` (numeric, default 0)

## 2. New Tables

### cutting_orders
- Cutting & loading work orders for finished steel products
- `id`, `user_id`, `order_no`, `customer_id`, `item_id`, `cut_length`, `qty`, `loading_qty`, `status`, `created_at`

### furnace_yields
- Furnace production yield records per heat
- `id`, `user_id`, `heat_no`, `furnace_no`, `charge_weight`, `output_weight`, `yield_pct`, `date`, `created_at`

### warehouse_stock
- Current stock levels per item per godown
- `id`, `user_id`, `item_id`, `godown`, `quantity`, `updated_at`

### chart_of_accounts
- Accounting chart of accounts
- `id`, `user_id`, `code`, `name`, `type` (asset/liability/equity/revenue/expense), `created_at`

### ledgers
- Individual ledger entries posting to accounts
- `id`, `user_id`, `account_id`, `entry_date`, `description`, `debit`, `credit`, `created_at`

## 3. Security
- RLS enabled on all new tables.
- Owner-scoped CRUD policies (4 per table, TO authenticated).
- All owner columns default to auth.uid().

## 4. Notes
- All ALTER TABLE statements use ADD COLUMN IF NOT EXISTS for idempotency.
- No destructive operations on existing tables.
*/

-- ============================================================
-- MODIFY EXISTING TABLES
-- ============================================================

ALTER TABLE items ADD COLUMN IF NOT EXISTS grade text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS size text;

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sales_person text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS loading_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cutting_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS transport_charge numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS other_charge numeric(12,2) NOT NULL DEFAULT 0;

-- ============================================================
-- CUTTING & LOADING
-- ============================================================

CREATE TABLE IF NOT EXISTS cutting_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  cut_length text,
  qty numeric(12,2) NOT NULL DEFAULT 0,
  loading_qty numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cutting_orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cutting_orders_user ON cutting_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_cutting_orders_customer ON cutting_orders(customer_id);

-- ============================================================
-- FURNACE YIELDS
-- ============================================================

CREATE TABLE IF NOT EXISTS furnace_yields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  heat_no text NOT NULL,
  furnace_no text,
  charge_weight numeric(12,2) NOT NULL DEFAULT 0,
  output_weight numeric(12,2) NOT NULL DEFAULT 0,
  yield_pct numeric(8,2) NOT NULL DEFAULT 0,
  yield_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE furnace_yields ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_furnace_yields_user ON furnace_yields(user_id);

-- ============================================================
-- LEGACY MASTER-DATA FOUNDATION
-- ============================================================
--
-- These five tables existed in the original hosted database before the
-- checked-in migration chain was exported.  The initial repository commit
-- already contained UI and later migrations that used them, but no CREATE
-- TABLE statements.  Keep this baseline deliberately minimal: subsequent
-- migrations add integrity constraints, tenant ownership, translations and
-- final RLS policies.

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  sub_category text,
  description text
);

CREATE TABLE IF NOT EXISTS uom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  symbol text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS godowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  warehouse_id uuid REFERENCES warehouses(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS transporters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vehicle_no text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- The tables are exposed through public, so enable RLS at creation.  Migration
-- 0020 installs the authenticated policies before application use.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE uom ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE godowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE transporters ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- WAREHOUSE STOCK
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  godown text NOT NULL DEFAULT 'Main',
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_user ON warehouse_stock(user_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_item ON warehouse_stock(item_id);

-- ============================================================
-- CHART OF ACCOUNTS
-- ============================================================

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_user ON chart_of_accounts(user_id);

-- ============================================================
-- LEDGERS
-- ============================================================

CREATE TABLE IF NOT EXISTS ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  debit numeric(12,2) NOT NULL DEFAULT 0,
  credit numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ledgers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ledgers_user ON ledgers(user_id);
CREATE INDEX IF NOT EXISTS idx_ledgers_account ON ledgers(account_id);

-- ============================================================
-- RLS POLICIES FOR NEW TABLES
-- ============================================================

-- cutting_orders
DROP POLICY IF EXISTS "select_own_cutting_orders" ON cutting_orders;
CREATE POLICY "select_own_cutting_orders" ON cutting_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_cutting_orders" ON cutting_orders;
CREATE POLICY "insert_own_cutting_orders" ON cutting_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_cutting_orders" ON cutting_orders;
CREATE POLICY "update_own_cutting_orders" ON cutting_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_cutting_orders" ON cutting_orders;
CREATE POLICY "delete_own_cutting_orders" ON cutting_orders FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- furnace_yields
DROP POLICY IF EXISTS "select_own_furnace_yields" ON furnace_yields;
CREATE POLICY "select_own_furnace_yields" ON furnace_yields FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_furnace_yields" ON furnace_yields;
CREATE POLICY "insert_own_furnace_yields" ON furnace_yields FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_furnace_yields" ON furnace_yields;
CREATE POLICY "update_own_furnace_yields" ON furnace_yields FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_furnace_yields" ON furnace_yields;
CREATE POLICY "delete_own_furnace_yields" ON furnace_yields FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- warehouse_stock
DROP POLICY IF EXISTS "select_own_warehouse_stock" ON warehouse_stock;
CREATE POLICY "select_own_warehouse_stock" ON warehouse_stock FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_warehouse_stock" ON warehouse_stock;
CREATE POLICY "insert_own_warehouse_stock" ON warehouse_stock FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_warehouse_stock" ON warehouse_stock;
CREATE POLICY "update_own_warehouse_stock" ON warehouse_stock FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_warehouse_stock" ON warehouse_stock;
CREATE POLICY "delete_own_warehouse_stock" ON warehouse_stock FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- chart_of_accounts
DROP POLICY IF EXISTS "select_own_chart_of_accounts" ON chart_of_accounts;
CREATE POLICY "select_own_chart_of_accounts" ON chart_of_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_chart_of_accounts" ON chart_of_accounts;
CREATE POLICY "insert_own_chart_of_accounts" ON chart_of_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_chart_of_accounts" ON chart_of_accounts;
CREATE POLICY "update_own_chart_of_accounts" ON chart_of_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_chart_of_accounts" ON chart_of_accounts;
CREATE POLICY "delete_own_chart_of_accounts" ON chart_of_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ledgers
DROP POLICY IF EXISTS "select_own_ledgers" ON ledgers;
CREATE POLICY "select_own_ledgers" ON ledgers FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_ledgers" ON ledgers;
CREATE POLICY "insert_own_ledgers" ON ledgers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_ledgers" ON ledgers;
CREATE POLICY "update_own_ledgers" ON ledgers FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_ledgers" ON ledgers;
CREATE POLICY "delete_own_ledgers" ON ledgers FOR DELETE TO authenticated USING (auth.uid() = user_id);
