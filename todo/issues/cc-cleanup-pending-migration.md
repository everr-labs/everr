# cc_cleanup_pending has no migration, so the hourly orphan sweep hard-fails

Blocker for PR #225. See [pr-225-review-findings.md](./pr-225-review-findings.md)
for the full review; this is finding 5.

## What
`cc_cleanup_pending` is a new table in the Drizzle schema with no corresponding
migration file. Production runs `drizzle-kit migrate`, not `drizzle-kit push`, so
the table never gets created and every call against it throws.

## Where
- Declared: `packages/app/src/db/schema/app.ts:317`
  (`export const ccCleanupPending = pgTable("cc_cleanup_pending", ...)`).
- Journal: `packages/app/drizzle/meta/_journal.json` ends at `0010_previews`.
  Nothing references the table.
- Consumed: `packages/app/src/data/alerts/preview-cleanup.server.ts`,
  `listPendingCleanupOrgs` (declared `:161`, implemented `:185`), called from
  `sweepOrphanCcRules` at `:264-269`.

## Failure scenario
The hourly `previews/cc-orphan-sweep` cron calls `sweepOrphanCcRules()`. Its first
statement is:

```ts
Promise.all([sweepDb.listPreviewOrgs(), sweepDb.listPendingCleanupOrgs()])
```

`listPendingCleanupOrgs` throws `relation "cc_cleanup_pending" does not exist`.
Unlike `markPending` and `clearPending`, which are individually wrapped, this call
sits outside any try/catch, so the rejection propagates and the whole sweep aborts
before it visits a single org.

Consequence: orphaned suppressed preview rules are never reaped. They keep
evaluating in CC forever, one accumulating set per abandoned preview, and the
sweep that exists to bound that cost never runs. The failure repeats hourly and
looks like a single cron error rather than a stuck cleanup loop.

## Why it is filed rather than fixed
The project convention is not to generate Drizzle migrations while the schema is
still being iterated on, because a generated migration pins the dev environment
and makes further schema changes awkward. So this is deliberately a pre-merge
step, not an oversight in the code: the schema declaration is right, the migration
is simply not written yet.

What makes it a blocker rather than a note is that the consequence is a hard
runtime failure on deploy, not a degradation.

## Sketch
- Generate the migration once the schema for this table is settled, so it lands as
  `0011_*` alongside the rest of the cutover.
- Independently of the migration, consider whether `sweepOrphanCcRules` should
  survive a failure in either listing rather than aborting wholesale. The
  asymmetry is the actual fragility: `markPending` and `clearPending` are guarded
  because a failure there is recoverable, but the two listings that open the sweep
  are not, so any error in either one costs the entire run. A `Promise.allSettled`
  with a logged partial result would keep the sweep useful when one source is
  unavailable.

## Related
- [alerts-cutover-tenant-migration.md](./alerts-cutover-tenant-migration.md) is the
  other migration gap in this cutover, and the two probably want to ship in the
  same migration pass.
