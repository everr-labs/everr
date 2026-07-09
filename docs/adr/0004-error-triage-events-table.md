# Error triage state lives in a dedicated append-only events table

Investigations, Resolutions, and Status changes on an Error are stored in a dedicated ClickHouse table, `app.error_triage_events`, keyed by `(tenant, fingerprint, event_id)`. Rows are never mutated in place: an edit or a delete appends a new version row for the same `event_id`, reads resolve the latest version (latest wins, deleted entries drop out), and `ReplacingMergeTree` physically discards superseded versions at merge time. An Error's Status is derived at read time from the latest status events; there is no stored status column and no Postgres row.

A metadata-only materialized view projects each insert into `app.logs` (event type, Fingerprint, action, timestamp, under `ServiceName='error-triage'` with `everr.error.*` attributes), so an Agent querying the plain SQL surface discovers triage activity like any other Signal and pivots to the errors read surface for content. The projection carries no markdown body and no author identity: content copied into the immutable logs table could never be redacted, so it is never copied.

## Considered options

- **Postgres `errors` row, materialized on first touch.** A mutable row per touched Error. Conventional and edit-friendly, but it splits Error state across two stores, needs new read paths for agents, and introduces the sync question of when rows materialize.
- **Plain log events in the existing logs tables.** Zero new schema, one write path, symmetric with OTLP ingestion. Rejected on erasure and lifecycle grounds: log rows are immutable and huge-table mutations are the one operation ClickHouse punishes, so editing or deleting an entry (a user-facing feature) and honoring a personal-data erasure request would both require mutating `app.logs`. Triage state would also expire with log retention, silently un-resolving Errors whose fix outlived the log window.
- **Dedicated table with a full-content logs projection** (the `app.alert_events` pattern verbatim). Rejected because a materialized view copies rows at insert time: bodies and author identity would land in `app.logs` as independent immutable rows, recreating the erasure problem the dedicated table exists to solve. Alert events get away with it because they are never edited.
- **Dedicated append-only table with a metadata-only logs projection** (chosen).

## Consequences

- **Edits and deletes are version appends.** Author-only in the product for now; the timeline marks edited entries. Superseded versions vanish at background merges; a hard erasure deadline is met by `OPTIMIZE TABLE app.error_triage_events FINAL` on what is a small, human-scale table.
- **The table stores author ids only.** Display names and avatars resolve from the user profile at read time, so a rename or an account erasure never requires touching event rows.
- **No TTL.** Triage knowledge is small and human-written, and a Resolution must outlive log retention. Per-tenant retention can be added later if demanded; recovering expired Resolutions could not.
- **Investigation content is not readable via raw SQL.** The logs surface carries activity markers only; content is served by the errors read surface (web UI, and the errors CLI commands when they land). This is the accepted price of erasability.
- **Reads must resolve versions explicitly.** `ReplacingMergeTree` collapses versions only at merge time, so every read groups by `event_id` and takes `argMax` by version. Status derivation in the errors summary query joins this table instead of scanning log attributes, which is cheaper than the rejected log-events model.
- **State is keyed by raw fingerprint.** A change to the fingerprint normalization algorithm orphans attached events silently. Accepted, as before.
- **Derived fingerprints are not globally unique.** `cityHash64`-derived fingerprints can collide across Organizations, so every event carries and is filtered by tenant; the row-level tenant policy is load-bearing for correctness, not just isolation.
- **Local and desktop triage are deferred.** The Collector has no counterpart table yet, so the local errors surface stays read-only for now; the local write path is decided when that work starts.
- **`event_time` is immutable across versions.** It orders the timeline and pins all versions of an entry into one partition, which the merge-time collapse requires. Version rows carry `updated_at` for the edited marker.
