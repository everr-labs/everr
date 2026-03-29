# Missing indexes for realtime queries

## What
Resolved. Added `(tenant_id, last_event_at DESC)` index, reordered `(tenant_id, repository, sha, ref)` index, and simplified 3 queries (COALESCE removal, redundant predicate removal, status filter pushed to SQL).

## Priority
resolved
