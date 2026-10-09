-- NAVILO COA timestamp integrity.
-- Set last-modified time on substantive updates, including changes made through
-- any authenticated client / RPC. This does not change journal or ledger data.
-- Historic edits did not record timestamps, so do not invent past edit dates.
BEGIN;

CREATE OR REPLACE FUNCTION public.touch_chart_of_accounts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  -- Other BEFORE triggers may normalize tenant/user metadata; run after them.
  -- Do not let an UPDATE carrying only updated_at forge the edit timestamp.
  IF (to_jsonb(NEW) - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_coa_touch_updated_at ON public.chart_of_accounts;
CREATE TRIGGER zz_coa_touch_updated_at
BEFORE UPDATE ON public.chart_of_accounts
FOR EACH ROW
EXECUTE FUNCTION public.touch_chart_of_accounts_updated_at();

COMMENT ON FUNCTION public.touch_chart_of_accounts_updated_at() IS
'Automatically records actual changes to Chart of Accounts; does not guess historic edit timestamps or modify posted balances.';

-- Use an ephemeral unscoped test table to exercise trigger logic without
-- modifying any company account or financial evidence.
CREATE TEMP TABLE coa_timestamp_trigger_probe (
  id integer primary key,
  name text NOT NULL,
  updated_at timestamptz NOT NULL
) ON COMMIT DROP;

CREATE TRIGGER test_coa_timestamp
BEFORE UPDATE ON coa_timestamp_trigger_probe
FOR EACH ROW
EXECUTE FUNCTION public.touch_chart_of_accounts_updated_at();

INSERT INTO coa_timestamp_trigger_probe(id, name, updated_at)
VALUES(1, 'Before', '2026-01-01T00:00:00Z');

UPDATE coa_timestamp_trigger_probe
SET name = 'After'
WHERE id = 1;

DO $verify$
DECLARE
  first_stamp timestamptz;
  second_stamp timestamptz;
BEGIN
  SELECT updated_at INTO first_stamp FROM coa_timestamp_trigger_probe WHERE id = 1;
  IF first_stamp <= '2026-01-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'COA timestamp probe failed: substantive change not timestamped';
  END IF;
  UPDATE coa_timestamp_trigger_probe SET name = 'After',
    updated_at = '2020-01-01T00:00:00Z'
  WHERE id = 1;
  SELECT updated_at INTO second_stamp FROM coa_timestamp_trigger_probe WHERE id = 1;
  IF second_stamp <> first_stamp THEN
    RAISE EXCEPTION 'COA timestamp probe failed: unchanged record tampered with timestamp';
  END IF;
END;
$verify$;

COMMIT;
