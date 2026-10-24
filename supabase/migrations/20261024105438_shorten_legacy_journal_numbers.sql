-- Use short sequential journal references and normalize legacy long codes.
BEGIN;

CREATE OR REPLACE FUNCTION public.post_cutover_opening_balances(p_cutover_date date, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare u uuid:=public.legacy_data_user_id();c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();td numeric;tc numeric;j uuid;x jsonb;aid uuid;pt text;pid uuid;pname text;coa public.chart_of_accounts%rowtype;ar uuid;ap uuid;res jsonb;
begin perform public.assert_module_permission('accounting','post');if u is null or c is null or b is null or loc is null then raise exception 'Authentication, active company, business unit and branch are required.';end if;if p_cutover_date is null then raise exception 'Cut-over date is required.';end if;if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'At least two cut-over opening lines are required.';end if;if exists(select 1 from public.cutover_opening_balance_batches q where q.company_id=c and q.business_unit_id=b) then raise exception 'Cut-over opening balances are already posted for this business unit.';end if;if exists(select 1 from public.opening_balance_batches q where q.company_id=c and q.business_unit_id=b) then raise exception 'Annual opening balances already exist for this business unit.';end if;if exists(select 1 from public.ledgers l where l.company_id=c and l.business_unit_id=b and l.entry_date<p_cutover_date) then raise exception 'Prior ledger activity exists before cut-over date. Cut-over import is allowed only for a clean business unit.';end if;select account_id into ar from public.account_mappings where user_id=u and company_id=c and mapping_key='accounts_receivable';select account_id into ap from public.account_mappings where user_id=u and company_id=c and mapping_key='accounts_payable';select round(sum(coalesce((value->>'debit')::numeric,0)),2),round(sum(coalesce((value->>'credit')::numeric,0)),2) into td,tc from jsonb_array_elements(p_lines);if td<=0 or abs(td-tc)>=.01 then raise exception 'Cut-over opening balances must have equal positive debit and credit totals.';end if;insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,source_module,source_document_type) values(u,c,b,loc,public.next_document_number('cutover_opening_balance','COB-'),p_cutover_date,'Cut-over opening balances','draft','Opening Balance','accounting','cutover_opening_balances') returning id into j;
for x in select value from jsonb_array_elements(p_lines) loop aid:=(x->>'account_id')::uuid;pt:=nullif(lower(trim(x->>'party_type')),'');pid:=nullif(x->>'party_id','')::uuid;pname:=nullif(trim(x->>'party_name'),'');select * into coa from public.chart_of_accounts where id=aid and user_id=u and company_id=c and is_active=true and is_group=false;if not found then raise exception 'Invalid cut-over account.';end if;if coa.type in ('revenue','expense') then raise exception 'Revenue and expense accounts cannot carry cut-over opening balances.';end if;if coalesce((x->>'debit')::numeric,0)<0 or coalesce((x->>'credit')::numeric,0)<0 or (coalesce((x->>'debit')::numeric,0)>0 and coalesce((x->>'credit')::numeric,0)>0) or (coalesce((x->>'debit')::numeric,0)<=0 and coalesce((x->>'credit')::numeric,0)<=0) then raise exception 'Each cut-over line must contain exactly one positive Debit or Credit amount.';end if;if aid=ar then if pt is distinct from 'customer' or pid is null or not exists(select 1 from public.customers z where z.id=pid and z.company_id=c and z.account_id=ar and z.is_active=true) then raise exception 'Accounts Receivable cut-over lines require a valid Customer.';end if;select name into pname from public.customers where id=pid and company_id=c;elsif aid=ap then if pt is distinct from 'supplier' or pid is null or not exists(select 1 from public.suppliers z where z.id=pid and z.company_id=c and z.account_id=ap and z.is_active=true) then raise exception 'Accounts Payable cut-over lines require a valid Supplier.';end if;select name into pname from public.suppliers where id=pid and company_id=c;elsif pid is not null or pt is not null then raise exception 'Party can only be selected on Accounts Receivable or Accounts Payable cut-over lines.';end if;insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name) values(u,c,b,loc,j,coa.id,coa.code||' - '||coa.name,round(coalesce((x->>'debit')::numeric,0),2),round(coalesce((x->>'credit')::numeric,0),2),pt,pid,pname);end loop;res:=public.post_journal_entry(j);insert into public.cutover_opening_balance_batches(user_id,company_id,business_unit_id,cutover_date,journal_entry_id,total_debit,total_credit,created_by) values(u,c,b,p_cutover_date,j,td,tc,auth.uid());insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,new_data,metadata) values(u,'accounting','POST_CUTOVER_OPENING_BALANCES','cutover_opening_balance_batches',j,'Cut-over opening balances',auth.uid(),jsonb_build_object('total_debit',td,'total_credit',tc),jsonb_build_object('company_id',c,'business_unit_id',b,'operating_location_id',loc,'cutover_date',p_cutover_date));return jsonb_build_object('success',true,'journal_entry_id',j,'cutover_date',p_cutover_date,'total_debit',td,'total_credit',tc,'post_result',res);end$function$
;

DO $renumber$
DECLARE
  v_actor uuid;
  v_old_gate text;
  v_scope record;
  v_sequence_id uuid;
  v_map_count integer;
BEGIN
  SELECT id INTO v_actor FROM auth.users WHERE lower(email)=lower('sales.connect91@gmail.com') LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Audit actor not found; number normalization stopped.'; END IF;

  CREATE TEMP TABLE navilo_short_journal_number_map ON COMMIT DROP AS
  WITH long_entries AS (
    SELECT je.id,je.company_id,je.business_unit_id,je.entry_no,je.entry_date,
           row_number() OVER (
             PARTITION BY je.company_id,je.business_unit_id
             ORDER BY je.entry_date,je.id
           ) AS rn
    FROM public.journal_entries je
    WHERE je.entry_no ~ '^JE-[0-9]{5,}$'
      AND je.entry_no <> 'JE-000001'
  ),
  scopes AS (
    SELECT DISTINCT company_id,business_unit_id FROM long_entries
  ),
  bases AS (
    SELECT s.company_id,s.business_unit_id,
      greatest(
        coalesce(ds.next_number,1),
        coalesce(max(
          CASE WHEN e.entry_no ~ '^JE-[0-9]{1,4}$'
               THEN substring(e.entry_no from 4)::bigint END
        ),0)+1
      ) AS start_number
    FROM scopes s
    LEFT JOIN public.document_sequences ds
      ON ds.company_id=s.company_id
     AND ds.business_unit_id=s.business_unit_id
     AND ds.document_type='manual_journal'
    LEFT JOIN public.journal_entries e
      ON e.company_id=s.company_id
     AND e.business_unit_id=s.business_unit_id
     AND e.entry_no ~ '^JE-[0-9]{1,4}$'
    GROUP BY s.company_id,s.business_unit_id,ds.next_number
  ),
  assigned AS (
    SELECT le.id,le.company_id,le.business_unit_id,le.entry_no AS old_no,
      'JE-'||lpad((b.start_number+le.rn-1)::text,
                   greatest(4,length((b.start_number+le.rn-1)::text)),'0') AS new_no
    FROM long_entries le
    JOIN bases b USING(company_id,business_unit_id)
  )
  SELECT id,company_id,business_unit_id,old_no,new_no FROM assigned
  UNION ALL
  SELECT je.id,je.company_id,je.business_unit_id,je.entry_no,'JE-0001'
  FROM public.journal_entries je
  WHERE je.entry_no='JE-000001'
  UNION ALL
  SELECT je.id,je.company_id,je.business_unit_id,je.entry_no,'COB-0001'
  FROM public.journal_entries je
  WHERE je.entry_no LIKE 'COB-%'
    AND je.source_document_type='cutover_opening_balances'
    AND length(je.entry_no)>8;

  SELECT count(*) INTO v_map_count FROM navilo_short_journal_number_map;
  IF v_map_count <> 10 THEN
    RAISE EXCEPTION 'Expected 10 legacy journal numbers to normalize; found %. Transaction stopped.',v_map_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM navilo_short_journal_number_map m
    JOIN public.journal_entries je
      ON je.company_id=m.company_id
     AND je.business_unit_id=m.business_unit_id
     AND lower(btrim(je.entry_no))=lower(btrim(m.new_no))
     AND je.id<>m.id
  ) THEN
    RAISE EXCEPTION 'A short journal number is already in use; normalization stopped.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM navilo_short_journal_number_map
    GROUP BY company_id,business_unit_id,lower(new_no) HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'The proposed short journal numbers collide; normalization stopped.';
  END IF;

  INSERT INTO public.audit_logs
    (user_id,module,action,table_name,record_id,record_name,performed_by,
     performed_email,old_data,new_data,metadata)
  SELECT v_actor,'accounting','RENUMBER','journal_entries',je.id,m.old_no,
         'sales.connect91@gmail.com','sales.connect91@gmail.com',
         jsonb_build_object('entry_no',m.old_no,'status',je.status,'entry_date',je.entry_date),
         jsonb_build_object('entry_no',m.new_no,'status',je.status,'entry_date',je.entry_date),
         jsonb_build_object('reason','Shorten legacy journal numbers; no dates, accounts or amounts changed.')
  FROM navilo_short_journal_number_map m
  JOIN public.journal_entries je ON je.id=m.id;

  v_old_gate:=current_setting('app.maintenance_reset',true);
  PERFORM set_config('app.maintenance_reset','1',true);
  UPDATE public.journal_entries je
     SET entry_no=m.new_no
    FROM navilo_short_journal_number_map m
   WHERE je.id=m.id;
  PERFORM set_config('app.maintenance_reset',coalesce(v_old_gate,''),true);

  FOR v_scope IN
    SELECT je.company_id,je.business_unit_id,
           max(substring(je.entry_no from 4)::bigint)+1 AS next_number
    FROM public.journal_entries je
    WHERE je.entry_no ~ '^JE-[0-9]+$'
    GROUP BY je.company_id,je.business_unit_id
  LOOP
    SELECT id INTO v_sequence_id
    FROM public.document_sequences
    WHERE company_id=v_scope.company_id
      AND business_unit_id=v_scope.business_unit_id
      AND document_type='manual_journal'
    FOR UPDATE;

    IF v_sequence_id IS NULL THEN
      INSERT INTO public.document_sequences
        (company_id,business_unit_id,document_type,prefix,next_number,padding,reset_policy,last_period_key,is_active)
      VALUES
        (v_scope.company_id,v_scope.business_unit_id,'manual_journal','JE-',v_scope.next_number,4,'never',extract(year from current_date)::int::text,true);
    ELSE
      UPDATE public.document_sequences
         SET prefix='JE-',
             next_number=greatest(next_number,v_scope.next_number),
             padding=4,
             reset_policy='never',
             last_period_key=coalesce(last_period_key,extract(year from current_date)::int::text),
             is_active=true,
             updated_at=now()
       WHERE id=v_sequence_id;
    END IF;
    v_sequence_id:=NULL;
  END LOOP;
END
$renumber$;

NOTIFY pgrst, 'reload schema';
COMMIT;

