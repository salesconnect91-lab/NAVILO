# Transport database rehearsal

Run `npm ci` then `npm run test:transport-db` from the repository root.
The runner replays every checked-in migration in filename order into a fresh,
in-memory PGlite PostgreSQL database. It supplies the Supabase auth/storage
schemas and authenticated default grants, then runs eight transactional SQL
rehearsals with synthetic fixtures that roll back. Assertions cover canonical
AR/AP, payroll attribution, VAT, credits/reversals, allocations, access controls,
financial closure, one-time rate entry, historical vehicle attribution, PPR
attachments, and a customer/supplier advances and later allocation, atomic cash bill/receipt, and a 500-row expense upload with retry/invalid-party checks.

This is a PostgreSQL-in-WASM rehearsal, not a full local Supabase stack.
It does not verify concurrent backend sessions, Storage HTTP, Auth HTTP or
PostgREST. Full-stack acceptance still requires the same migration chain and
SQL rehearsals against an isolated local Supabase stack with Docker available.
The initial-rate RPC takes a Trip row lock before checking finalization and
never routes a competing initial request through the override path.
