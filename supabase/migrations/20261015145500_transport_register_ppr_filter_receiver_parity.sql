-- NAVILO: PPR receiver names in filter options, filter comparisons and
-- global search must match the already displayed audited correction names.
-- Read-only function update; no Trip, PPR or audit data is modified.
DO $fix$
DECLARE
 body text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 section text;
 head text;
 tail text;
 p integer;
 q integer;
 fast_count integer;
 general_count integer;
BEGIN
 p:=position($start$ -- Unposted operational filter values must not require the expensive$start$ in body);
 q:=position($finish$ -- A wholly unlinked, unposted workspace needs operational aggregates$finish$ in body);
 IF p=0 OR q<=p THEN RAISE EXCEPTION 'Transport register PPR filter baseline changed'; END IF;
 head:=left(body,p-1);
 section:=substr(body,p,q-p);
 tail:=substr(body,q);
 IF position('pc.corrected_name' in section)>0 AND
    position('pc.corrected_name' in tail)>0 AND
    position($new$coalesce((select pc.corrected_name from public.transport_ppr_receiver_corrections pc where pc.trip_id=r.id and pc.company_id=c and pc.business_unit_id=b),r.ppr_received_by_name)$new$ in tail)>0
 THEN RAISE NOTICE 'PPR receiver filter parity already active'; RETURN; END IF;
 fast_count:=(length(section)-length(replace(section,$oldfast$then coalesce(nullif(t.ppr_received_by_name,''),'—')$oldfast$,'')))/length($oldfast$then coalesce(nullif(t.ppr_received_by_name,''),'—')$oldfast$);
 general_count:=(length(tail)-length(replace(tail,$oldgeneral$r.ppr_received_by_name$oldgeneral$,'')))/length($oldgeneral$r.ppr_received_by_name$oldgeneral$);
 IF fast_count<>1 OR general_count<>3
 THEN RAISE EXCEPTION 'Expected one fast PPR label and three financial filter/search references, found % and %',fast_count,general_count; END IF;
 section:=replace(section,$oldfast$then coalesce(nullif(t.ppr_received_by_name,''),'—')$oldfast$,$newfast$then coalesce(nullif((select pc.corrected_name from public.transport_ppr_receiver_corrections pc where pc.trip_id=t.id and pc.company_id=c and pc.business_unit_id=b),''),nullif(t.ppr_received_by_name,''),'—')$newfast$);
 tail:=replace(tail,$oldgeneral$r.ppr_received_by_name$oldgeneral$,$newgeneral$coalesce((select pc.corrected_name from public.transport_ppr_receiver_corrections pc where pc.trip_id=r.id and pc.company_id=c and pc.business_unit_id=b),r.ppr_received_by_name)$newgeneral$);
 EXECUTE head||section||tail;
END
$fix$;