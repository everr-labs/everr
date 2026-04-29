## What

`upsertOrgSubscription` in `packages/app/src/lib/billing-data.server.ts` unconditionally overwrites the row keyed by `orgId` on every Polar subscription webhook. If webhook deliveries arrive out of order (Polar does not guarantee ordering, and retries can interleave), a late stale event can clobber a fresher state — e.g., `subscription.canceled` arriving after `subscription.active` and rolling the row back, or vice versa.

## Where

- `packages/app/src/lib/billing-data.server.ts` — `upsertOrgSubscription`
- `packages/app/src/lib/auth.server.ts` — `syncSubscription` is wired to 6 Polar subscription events, all of which feed this upsert

## Steps to reproduce

1. Trigger a subscription state change (e.g., cancel) and immediately have Polar retry an earlier `subscription.updated` webhook.
2. Observe that the older event arrives last and overwrites the newer state in `org_subscription`.

## Expected

Stale events are dropped; the row reflects the latest Polar state.

## Actual

Last writer wins regardless of event recency.

## Priority

low

## Notes

Considered fix: add a `polar_modified_at` column populated from the webhook payload's `modifiedAt`, and gate `onConflictDoUpdate` with `setWhere: EXCLUDED.polar_modified_at > polar_modified_at`. Reverted from the original PR because it duplicates `updated_at`. Alternative: replace `updated_at`'s semantics with the Polar-supplied timestamp (single column) — loses local "last touched" but is simpler. Webhook secret verification is already handled by `@polar-sh/better-auth`; this is purely about ordering.
