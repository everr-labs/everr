# Surface orgId directly on the server-fn context

## What
`requireOrgMiddleware` already validates `activeOrganizationId` and narrows it to non-null, but only re-packs it inside the session object. Every handler still digs it out by hand. Put `orgId` (and plausibly `userId`) directly on the middleware context so handlers destructure it.

## Where
- **The middleware:** `packages/app/src/lib/serverFn.ts:21` (`requireOrgMiddleware`), which builds `context: { session, clickhouse }` and re-nests the narrowed org id back into `session.session.activeOrganizationId`.
- **The deref boilerplate:** 45 inline `session.session.activeOrganizationId` derefs across ~15 non-test files (`data/auth.ts`, `data/onboarding.ts`, `data/dashboards/server.ts`, `data/billing.ts`, `data/api-keys.ts`, `data/account-settings.ts`, the `routes/api/cli/*` endpoints, ...).
- **The workaround:** `data/cc/server.ts:38` defines a local `orgId(session)` helper, called 41 times in that file alone.

## Why it matters
~90 call sites repeat a two-level deref for a value the middleware has already validated, and one file has grown a private helper to cope. Surfacing `orgId` on the context makes the "org-scoped by construction" guarantee visible at every handler signature, deletes the local helper, and turns the whole thing into a mechanical destructure.

## Sketch
- `requireOrgMiddleware` returns `context: { session, orgId: activeOrgId, clickhouse }`.
- Mechanically replace `session.session.activeOrganizationId` / `orgId(session)` with the destructured `orgId` across handlers; delete `data/cc/server.ts`'s local helper.
- Consider `userId: session.user.id` in the same pass if the deref count justifies it.

## Related
Sibling of `consolidate-datetime-formatting.md`: both came out of the same "what else is worth generalizing" sweep after the alerting components move.
