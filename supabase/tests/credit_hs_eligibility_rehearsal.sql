-- Isolated-only regression fixture. Never connect this file to a live database.
BEGIN;
CREATE TEMP TABLE credit_invoice_fixture (
 id integer PRIMARY KEY, credit boolean NOT NULL,
 invoice_no text, posted boolean NOT NULL,
 paid numeric(12,2) NOT NULL DEFAULT 0,
 opening_linked boolean NOT NULL DEFAULT false,
 sales_journal_valid boolean NOT NULL DEFAULT false,
 opening_journal_valid boolean NOT NULL DEFAULT false
);
INSERT INTO credit_invoice_fixture VALUES
 (1,true,'H-S-001',true,0,true,true,true),
 (2,true,'H-S-002',true,100,true,true,true),
 (3,false,'H-S-003',true,0,true,true,true),
 (4,true,'H-S-004',true,0,true,false,true),
 (5,true,'H-S-005',true,0,true,true,false),
 (6,true,'INV-889',true,0,true,true,true);
CREATE TEMP VIEW unpaid_correction_candidates AS
 SELECT id FROM credit_invoice_fixture
 WHERE credit AND posted AND invoice_no LIKE 'H-S-%'
   AND paid=0 AND opening_linked AND sales_journal_valid
   AND opening_journal_valid;
DO $$
DECLARE actual integer[];
BEGIN
 SELECT array_agg(id ORDER BY id) INTO actual FROM unpaid_correction_candidates;
 IF actual IS DISTINCT FROM ARRAY[1] THEN
   RAISE EXCEPTION 'Eligibility regression: expected only invoice 1, got %',actual;
 END IF;
 IF EXISTS(SELECT 1 FROM unpaid_correction_candidates c JOIN credit_invoice_fixture f USING(id)
    WHERE f.paid<>0 OR NOT f.credit OR NOT f.opening_linked
       OR NOT f.sales_journal_valid OR NOT f.opening_journal_valid)
 THEN RAISE EXCEPTION 'Ineligible customer invoice entered unpaid correction'; END IF;
END $$;
ROLLBACK;
-- Synthetic candidate filtering only. Not evidence that NAVILO posted data can be corrected.
