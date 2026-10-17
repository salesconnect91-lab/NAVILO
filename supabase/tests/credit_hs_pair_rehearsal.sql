-- Synthetic fixture ONLY. Never run against production.
BEGIN;
CREATE TEMP TABLE original_journal (
 invoice_id int, side text, account text, debit numeric(14,2), credit numeric(14,2)
);
INSERT INTO original_journal VALUES
(1,'OPENING','AR',0,1150),
(1,'OPENING','OPENING_EQUITY',1150,0),
(1,'SALES','AR',1150,0),
(1,'SALES','REVENUE',0,1000),
(1,'SALES','OUTPUT_VAT',0,150),
(2,'OPENING','AR',0,700),
(2,'OPENING','OPENING_EQUITY',700,0),
(2,'SALES','AR',700,0),
(2,'SALES','REVENUE',0,700);
CREATE TEMP TABLE correction_reversal AS
SELECT invoice_id,side,account,credit AS debit,debit AS credit FROM original_journal;
DO $$
DECLARE bad integer;
BEGIN
 SELECT count(*) INTO bad FROM (
  SELECT invoice_id,side FROM original_journal GROUP BY invoice_id,side
  HAVING sum(debit) <> sum(credit)
 ) s;
 IF bad<>0 THEN RAISE EXCEPTION 'Original journal pair unbalanced'; END IF;
 SELECT count(*) INTO bad FROM (
  SELECT invoice_id,side FROM correction_reversal GROUP BY invoice_id,side
  HAVING sum(debit) <> sum(credit)
 ) s;
 IF bad<>0 THEN RAISE EXCEPTION 'Reversal journal pair unbalanced'; END IF;
 SELECT count(*) INTO bad FROM (
  SELECT invoice_id,account FROM (
    SELECT invoice_id,account,debit,credit FROM original_journal
    UNION ALL
    SELECT invoice_id,account,debit,credit FROM correction_reversal
  ) q GROUP BY invoice_id,account
  HAVING sum(debit)-sum(credit) <> 0
 ) s;
 IF bad<>0 THEN RAISE EXCEPTION 'Correction did not net to zero'; END IF;
 IF (SELECT count(DISTINCT invoice_id) FROM correction_reversal)<>2
 THEN RAISE EXCEPTION 'Synthetic sample incomplete'; END IF;
END $$;
ROLLBACK;
-- This checks arithmetic only, NOT production triggers, posting permissions,
-- conversion links or the actual NAVILO correction RPC. Do not deploy corrections
-- based solely on this PASS.
