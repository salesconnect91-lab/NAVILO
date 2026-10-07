begin;
alter table public.transport_trips enable trigger transport_customer_commercial_lock;
alter table public.transport_trips enable trigger zz_transport_posted_rate_guard;
commit;