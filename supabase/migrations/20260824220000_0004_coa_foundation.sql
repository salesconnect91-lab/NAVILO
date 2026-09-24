-- MetalForge OS — COA Foundation
-- Safe, additive migration for the existing chart_of_accounts / journal_lines design.

-- The hosted legacy schema already had these accounting/document columns before
-- migration history was exported.  Migration 0005 reads journal payment metadata
-- and migration 0007 posts against these sales/journal fields, so a clean database
-- must restore them after chart_of_accounts exists and before those consumers run.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS payment_mode text DEFAULT 'Cash',
  ADD COLUMN IF NOT EXISTS party_name text,
  ADD COLUMN IF NOT EXISTS received_by text,
  ADD COLUMN IF NOT EXISTS trans_type text DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS balance_before numeric,
  ADD COLUMN IF NOT EXISTS payment_amount numeric,
  ADD COLUMN IF NOT EXISTS balance_after numeric;

ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS party_name text,
  ADD COLUMN IF NOT EXISTS party_type text,
  ADD COLUMN IF NOT EXISTS party_id uuid;

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS customer_account_id uuid REFERENCES public.chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS sales_person_account_id uuid REFERENCES public.chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'Credit',
  ADD COLUMN IF NOT EXISTS payment_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS normal_balance text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_system_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_manual_entries boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS detail_type text,
  ADD COLUMN IF NOT EXISTS parent_head text,
  ADD COLUMN IF NOT EXISTS account_role text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.chart_of_accounts
SET normal_balance = CASE
  WHEN type IN ('asset','expense') THEN 'debit'
  ELSE 'credit'
END
WHERE normal_balance IS NULL;

ALTER TABLE public.chart_of_accounts
  ALTER COLUMN normal_balance SET DEFAULT 'debit';

CREATE INDEX IF NOT EXISTS idx_coa_parent ON public.chart_of_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_coa_active ON public.chart_of_accounts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_coa_type ON public.chart_of_accounts(user_id, type);

-- Remove duplicate codes per user before enforcing uniqueness. The newest row survives.
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id, code ORDER BY created_at DESC, id DESC) AS rn
  FROM public.chart_of_accounts
)
DELETE FROM public.chart_of_accounts c
USING duplicates d
WHERE c.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_user_code
  ON public.chart_of_accounts(user_id, code);

ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_normal_balance_check;
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_normal_balance_check
  CHECK (normal_balance IN ('debit','credit'));

ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_account_role_check;
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_account_role_check
  CHECK (account_role IN ('general','party','sales_person','charge','system'));

-- Journal lines keep the legacy text column for backwards compatibility, but now also
-- carry the immutable COA UUID used for all new postings.
ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id
  ON public.journal_lines(account_id);

-- Stable account mappings: modules use a key, never an account name/code.
CREATE TABLE IF NOT EXISTS public.account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  mapping_key text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, mapping_key)
);

ALTER TABLE public.account_mappings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_account_mappings_user ON public.account_mappings(user_id);
CREATE INDEX IF NOT EXISTS idx_account_mappings_account ON public.account_mappings(account_id);

DROP POLICY IF EXISTS "select_own_account_mappings" ON public.account_mappings;
CREATE POLICY "select_own_account_mappings" ON public.account_mappings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_account_mappings" ON public.account_mappings;
CREATE POLICY "insert_own_account_mappings" ON public.account_mappings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_account_mappings" ON public.account_mappings;
CREATE POLICY "update_own_account_mappings" ON public.account_mappings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_account_mappings" ON public.account_mappings;
CREATE POLICY "delete_own_account_mappings" ON public.account_mappings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Dedicated COA audit log. This is intentionally separate from the existing generic
-- audit UI so account changes remain available even when an account is deactivated.
CREATE TABLE IF NOT EXISTS public.account_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DEACTIVATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_account_audit_user ON public.account_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_audit_account ON public.account_audit_logs(account_id);

DROP POLICY IF EXISTS "select_own_account_audit_logs" ON public.account_audit_logs;
CREATE POLICY "select_own_account_audit_logs" ON public.account_audit_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_coa_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coa_updated_at ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_updated_at
BEFORE UPDATE ON public.chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_coa_updated_at();

CREATE OR REPLACE FUNCTION public.audit_coa_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.account_audit_logs(user_id, account_id, action, new_data)
    VALUES (NEW.user_id, NEW.id, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.account_audit_logs(user_id, account_id, action, old_data, new_data)
    VALUES (
      NEW.user_id,
      NEW.id,
      CASE WHEN OLD.is_active = true AND NEW.is_active = false THEN 'DEACTIVATE' ELSE 'UPDATE' END,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSE
    INSERT INTO public.account_audit_logs(user_id, account_id, action, old_data)
    VALUES (OLD.user_id, OLD.id, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_coa_audit ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_audit
AFTER INSERT OR UPDATE OR DELETE ON public.chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION public.audit_coa_changes();

-- Prevent deleting a group that still has children.
CREATE OR REPLACE FUNCTION public.prevent_coa_delete_if_used()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE parent_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete account % because it has child accounts. Deactivate it instead.', OLD.code;
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_lines WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete account % because journal entries reference it. Deactivate it instead.', OLD.code;
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_mappings WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete account % because an account mapping references it. Reassign the mapping first.', OLD.code;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_coa_delete ON public.chart_of_accounts;
CREATE TRIGGER trg_prevent_coa_delete
BEFORE DELETE ON public.chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION public.prevent_coa_delete_if_used();

-- Default COA initializer. Safe to call once after login for every company/user.
CREATE OR REPLACE FUNCTION public.initialize_default_coa()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  root_id uuid;
  child_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Root groups
  INSERT INTO chart_of_accounts(user_id, code, name, type, is_group, normal_balance, allow_manual_entries, is_system_account, detail_type)
  VALUES
    (uid,'1000','Assets','asset',true,'debit',false,true,'Assets'),
    (uid,'2000','Liabilities','liability',true,'credit',false,true,'Liabilities'),
    (uid,'3000','Equity','equity',true,'credit',false,true,'Equity'),
    (uid,'4000','Revenue','revenue',true,'credit',false,true,'Revenue'),
    (uid,'5000','Cost of Sales','expense',true,'debit',false,true,'Cost of Sales'),
    (uid,'6000','Expenses','expense',true,'debit',false,true,'Expenses')
  ON CONFLICT (user_id, code) DO NOTHING;

  -- Sub-groups
  INSERT INTO chart_of_accounts(user_id, code, name, type, parent_id, is_group, normal_balance, allow_manual_entries, is_system_account, detail_type)
  SELECT uid,'1100','Current Assets','asset',id,true,'debit',false,true,'Current Assets' FROM chart_of_accounts WHERE user_id=uid AND code='1000'
  ON CONFLICT (user_id, code) DO NOTHING;
  INSERT INTO chart_of_accounts(user_id, code, name, type, parent_id, is_group, normal_balance, allow_manual_entries, is_system_account, detail_type)
  SELECT uid,'1200','Fixed Assets','asset',id,true,'debit',false,true,'Fixed Assets' FROM chart_of_accounts WHERE user_id=uid AND code='1000'
  ON CONFLICT (user_id, code) DO NOTHING;
  INSERT INTO chart_of_accounts(user_id, code, name, type, parent_id, is_group, normal_balance, allow_manual_entries, is_system_account, detail_type)
  SELECT uid,'2100','Current Liabilities','liability',id,true,'credit',false,true,'Current Liabilities' FROM chart_of_accounts WHERE user_id=uid AND code='2000'
  ON CONFLICT (user_id, code) DO NOTHING;

  -- Posting accounts.
  INSERT INTO chart_of_accounts(user_id, code, name, type, parent_id, is_group, normal_balance, is_system_account, detail_type, account_role)
  SELECT uid, v.code, v.name, v.type, p.id, false, v.balance, true, v.detail_type, 'system'
  FROM (VALUES
    ('1110','Cash','asset','debit','Cash on Hand','1100'),
    ('1120','Bank','asset','debit','Bank Account','1100'),
    ('1130','Accounts Receivable','asset','debit','Accounts Receivable','1100'),
    ('1140','Inventory','asset','debit','Inventory','1100'),
    ('1150','Input VAT','asset','debit','Input VAT','1100'),
    ('1210','Machinery & Equipment','asset','debit','Machinery & Equipment','1200'),
    ('2110','Accounts Payable','liability','credit','Accounts Payable','2100'),
    ('2120','Output VAT','liability','credit','Output VAT','2100'),
    ('3100','Share Capital','equity','credit','Share Capital','3000'),
    ('3200','Retained Earnings','equity','credit','Retained Earnings','3000'),
    ('4100','Sales Revenue','revenue','credit','Product Sales','4000'),
    ('4200','Service Revenue','revenue','credit','Service Revenue','4000'),
    ('5100','Cost of Goods Sold','expense','debit','COGS','5000'),
    ('6100','Salaries & Wages','expense','debit','Salaries','6000'),
    ('6200','Rent','expense','debit','Rent','6000'),
    ('6300','Utilities','expense','debit','Utilities','6000'),
    ('6400','Transport & Freight','expense','debit','Transport','6000'),
    ('6500','General Expenses','expense','debit','General Expenses','6000')
  ) AS v(code,name,type,balance,detail_type,parent_code)
  JOIN chart_of_accounts p ON p.user_id=uid AND p.code=v.parent_code
  ON CONFLICT (user_id, code) DO NOTHING;

  -- Stable module mappings. The IDs remain valid even if the user renames an account.
  INSERT INTO account_mappings(user_id, mapping_key, account_id)
  SELECT uid, v.mapping_key, a.id
  FROM (VALUES
    ('cash','1110'),
    ('bank','1120'),
    ('accounts_receivable','1130'),
    ('inventory','1140'),
    ('input_vat','1150'),
    ('accounts_payable','2110'),
    ('output_vat','2120'),
    ('share_capital','3100'),
    ('retained_earnings','3200'),
    ('sales_revenue','4100'),
    ('service_revenue','4200'),
    ('cogs','5100'),
    ('salaries','6100'),
    ('rent','6200'),
    ('utilities','6300'),
    ('transport_expense','6400'),
    ('general_expense','6500')
  ) AS v(mapping_key, code)
  JOIN chart_of_accounts a ON a.user_id=uid AND a.code=v.code
  ON CONFLICT (user_id, mapping_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_default_coa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_default_coa() FROM anon;
GRANT EXECUTE ON FUNCTION public.initialize_default_coa() TO authenticated;
