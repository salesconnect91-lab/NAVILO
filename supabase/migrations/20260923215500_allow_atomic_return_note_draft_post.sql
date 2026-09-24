begin;

-- Return posting is atomic: the internal routine creates a draft row, builds
-- stock/accounting entries, then marks it posted.  The original table check
-- allowed only 'posted', making that transaction impossible.
alter table public.return_notes drop constraint if exists return_notes_status_check;
alter table public.return_notes
  add constraint return_notes_status_check
  check (status in ('draft','posted'));

commit;
