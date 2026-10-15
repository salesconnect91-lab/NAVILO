-- Keep unlinked and missing invoice/payment/header values at the bottom
-- for both ASC and DESC, and keep row_number() and page ORDER BY identical.
-- Read path only: no stored Trip/financial record is modified.
DO $fix$
DECLARE
  fn text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
  start_pos int:=position('chosen as materialized (' in fn);
  final_pos int:=position('chosen as materialized (' in fn)
    + position('), page as (' in substr(fn,position('chosen as materialized (' in fn))) - 1;
  chosen text;
BEGIN
  IF start_pos<=0 OR final_pos<=start_pos THEN
    RAISE EXCEPTION 'Register paging query changed; guarded correction aborted';
  END IF;
  chosen:=substr(fn,start_pos,final_pos-start_pos);
  IF position('nullif(x.vals->''cells''->>p_sort,''?'') end desc nulls last' in chosen)>0
  THEN
    RAISE NOTICE 'Both-direction nullable header sorting already corrected';
    RETURN;
  END IF;
  IF (length(chosen)-length(replace(chosen,$old$then x.trip_date end asc$old$,'')))/length($old$then x.trip_date end asc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then x.trip_date end asc$old$; END IF;
  chosen:=replace(chosen,$old$then x.trip_date end asc$old$,$new$then x.trip_date end asc nulls last$new$);
  IF (length(chosen)-length(replace(chosen,$old$then x.trip_date end desc$old$,'')))/length($old$then x.trip_date end desc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then x.trip_date end desc$old$; END IF;
  chosen:=replace(chosen,$old$then x.trip_date end desc$old$,$new$then x.trip_date end desc nulls last$new$);
  IF (length(chosen)-length(replace(chosen,$old$then x.payment_date end asc$old$,'')))/length($old$then x.payment_date end asc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then x.payment_date end asc$old$; END IF;
  chosen:=replace(chosen,$old$then x.payment_date end asc$old$,$new$then x.payment_date end asc nulls last$new$);
  IF (length(chosen)-length(replace(chosen,$old$then x.payment_date end desc$old$,'')))/length($old$then x.payment_date end desc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then x.payment_date end desc$old$; END IF;
  chosen:=replace(chosen,$old$then x.payment_date end desc$old$,$new$then x.payment_date end desc nulls last$new$);
  IF (length(chosen)-length(replace(chosen,$old$then (x.vals->'numbers'->>p_sort)::numeric end asc$old$,'')))/length($old$then (x.vals->'numbers'->>p_sort)::numeric end asc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then (x.vals->'numbers'->>p_sort)::numeric end asc$old$; END IF;
  chosen:=replace(chosen,$old$then (x.vals->'numbers'->>p_sort)::numeric end asc$old$,$new$then (x.vals->'numbers'->>p_sort)::numeric end asc nulls last$new$);
  IF (length(chosen)-length(replace(chosen,$old$then (x.vals->'numbers'->>p_sort)::numeric end desc$old$,'')))/length($old$then (x.vals->'numbers'->>p_sort)::numeric end desc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then (x.vals->'numbers'->>p_sort)::numeric end desc$old$; END IF;
  chosen:=replace(chosen,$old$then (x.vals->'numbers'->>p_sort)::numeric end desc$old$,$new$then (x.vals->'numbers'->>p_sort)::numeric end desc nulls last$new$);
  IF (length(chosen)-length(replace(chosen,$old$then x.vals->'cells'->>p_sort end asc$old$,'')))/length($old$then x.vals->'cells'->>p_sort end asc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then x.vals->'cells'->>p_sort end asc$old$; END IF;
  chosen:=replace(chosen,$old$then x.vals->'cells'->>p_sort end asc$old$,$new$then nullif(x.vals->'cells'->>p_sort,'?') end asc nulls last$new$);
  IF (length(chosen)-length(replace(chosen,$old$then x.vals->'cells'->>p_sort end desc$old$,'')))/length($old$then x.vals->'cells'->>p_sort end desc$old$)<>2
  THEN RAISE EXCEPTION 'Sorting clause changed: %',$old$then x.vals->'cells'->>p_sort end desc$old$; END IF;
  chosen:=replace(chosen,$old$then x.vals->'cells'->>p_sort end desc$old$,$new$then nullif(x.vals->'cells'->>p_sort,'?') end desc nulls last$new$);

  EXECUTE left(fn,start_pos-1)||chosen||substr(fn,final_pos);
END $fix$;