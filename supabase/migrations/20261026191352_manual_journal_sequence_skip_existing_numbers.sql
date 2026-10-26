-- Keep manual journal numbering ahead of imported/existing journal numbers.
-- No journal records or financial balances are modified.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.next_document_number(text,text)'::regprocedure) INTO definition;
 IF position('v_number:=v_seq.next_number;' in definition)=0 THEN
   RAISE EXCEPTION 'Unexpected document generator definition; refusing unsafe patch';
 END IF;
 definition:=replace(definition,'v_number:=v_seq.next_number;',$patch$
  IF p_document_type='manual_journal' AND coalesce(p_prefix,v_seq.prefix)='JE-' THEN
    SELECT greatest(v_seq.next_number,coalesce(max(substring(btrim(j.entry_no) from 4)::bigint),0)+1)
      INTO v_number
    FROM public.journal_entries j
    WHERE j.company_id=v_company
      AND j.business_unit_id IS NOT DISTINCT FROM v_unit
      AND btrim(j.entry_no) ~* '^JE-[0-9]{1,18}$';
    UPDATE public.document_sequences SET next_number=v_number,updated_at=now()
      WHERE id=v_seq.id RETURNING * INTO v_seq;
  END IF;
  v_number:=v_seq.next_number;
 $patch$);
 definition:=replace(definition,
   'return v_seq.prefix || lpad(v_number::text,v_seq.padding,''0'');',
   'return v_seq.prefix || lpad(v_number::text,CASE WHEN p_document_type=''manual_journal'' THEN greatest(v_seq.padding,length(v_number::text)) ELSE v_seq.padding END,''0'');');
 EXECUTE definition;
END $migration$;

UPDATE public.document_sequences s
SET next_number=greatest(s.next_number,coalesce((
 SELECT max(substring(btrim(j.entry_no) from 4)::bigint)+1
 FROM public.journal_entries j
 WHERE j.company_id=s.company_id
   AND j.business_unit_id IS NOT DISTINCT FROM s.business_unit_id
   AND btrim(j.entry_no) ~* '^JE-[0-9]{1,18}$'
),s.next_number)),updated_at=now()
WHERE s.document_type='manual_journal' AND s.prefix='JE-';
