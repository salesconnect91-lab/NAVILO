-- Prevent client-settable maintenance_reset GUC from bypassing posted return-note immutability.
-- Only trusted service-role maintenance can bypass these guards.
CREATE OR REPLACE FUNCTION public.prevent_posted_return_note_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted Credit/Debit Notes are immutable. Create a correcting document instead.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_posted_return_note_line_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_note uuid;
  v_status text;
BEGIN
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_note := CASE WHEN TG_OP = 'DELETE' THEN OLD.note_id ELSE NEW.note_id END;
  SELECT status INTO v_status FROM public.return_notes WHERE id = v_note;

  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Lines of a posted Credit/Debit Note are immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
