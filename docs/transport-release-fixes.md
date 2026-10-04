# Transport release fixes — 2026-10-04

This release blocks billing until rates/rents are explicitly finalized and the finalized snapshots agree. It separates customer and supplier financial reads, restores Business Unit gating, protects expense retries with persistent intent IDs, and retains canonical Sales/Purchase/Accounting posting paths.

Register export reads every filtered page and verifies a common revision and totals before producing the file. Financial fields are masked before filtering/sorting and customer/supplier reporting filters are applied at the server. Operational editing uses scoped RPCs for restricted roles. Lifecycle filters use the authoritative lifecycle value. New audit events include their real request/database source; historical unknown sources are retained.

Forward recovery restores missing tables, triggers, immutable helper access and legacy reporting view. Settlement increases retain the audited live contract. Document scope/actor constraints refuse missing historical values; the production preflight found no nulls. Exact duplicate indexes are removed while preserving constraints and replica identity. Anonymous Transport ACLs are removed.

Validation: fresh ordered migration replay; canonical financial, tenant isolation and FX rehearsals; complete 501/1,000/20,000-row export tests; frontend typecheck/unit tests/build. Native PostgreSQL CI adds concurrent creators, posting, same-intent costs, competing settlements, assignment replacements and the 20,000 operational Trip import/reader fixture.

The migration inventory is a provenance crosswalk, not permission to rewrite production migration history. Four historical route identifiers with free-text locations require evidence before linking; no historical financial data or audit sources are invented. Full historical 20,000-document accounting timing and all viewport acceptance remain separate measurements until evidence is recorded in the release audit.
