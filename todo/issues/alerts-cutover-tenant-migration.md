# The /alerts cutover silently stops notifications for existing tenants

Blocker for PR #225. See [pr-225-review-findings.md](./pr-225-review-findings.md)
for the full review; this is finding 4.

## What
The CC cutover deletes the in-process alerting pipeline and its Postgres tables
without any migration, backfill, or documented reconfigure step. An org that had
delivery configured before the deploy has it configured nowhere after.

Alerts still fire in CC and still land in `app.logs`, so the History page keeps
filling. Nobody is paged. The failure is silent in both directions: no error, no
empty-state that says anything is wrong, and the alerts themselves look healthy.

## Where
Deleted with no replacement path for existing rows:

- `packages/app/src/db/schema/alerts.ts`: `alert_definitions`, `alert_settings`,
  `alert_silences`.
- `packages/app/src/data/alerts/delivery-settings.ts`, which owned reading and
  writing `alert_settings.delivery`.
- `clickhouse/init/12-create-alert-events.sql` (dropped from a fresh install; the
  retirement script for existing clouds is now
  `clickhouse/drop-alert-events.sql`).

Still describing the deleted system: `docs/alert-notifications.md`, untouched by
the branch.

## Failure scenario
1. An org has Slack webhooks and a Telegram bot token in `alert_settings.delivery`
   and two active rows in `alert_silences`.
2. The cutover deploys. The tables are gone; no CC channel or receiver exists for
   that org, and no route points anywhere.
3. `/alerts/delivery` renders its empty state:
   "No routes yet: every alert is delivered to all firehose subscribers"
   (`packages/app/src/routes/_authenticated/_dashboard/alerts/delivery.tsx:322`).
   There are also zero firehose subscribers, so that sentence is describing
   delivery to nobody.
4. Every alert fires into `app.logs` and notifies no one.
5. The two silences are gone, so whatever was deliberately muted starts paging
   again at the same moment.

Step 5 is the sharp edge: the same deploy that stops wanted pages starts unwanted
ones.

## Why it needs a decision, not just code
Two defensible options, and the choice is a product call:

- **Backfill.** A one-shot migration reads `alert_settings.delivery` per org and
  provisions the equivalent CC objects: `cc.createChannel` per configured target,
  `cc.createReceiver` grouping them, and an idempotent catch-all route. Active
  `alert_silences` rows map onto CC silences scoped by the synthetic `rule` label.
  Preserves behavior across the deploy; costs a migration that has to run against
  live secrets (the delivery blob holds webhook URLs and bot tokens, which have to
  be re-encrypted into CC's envelope rather than copied).
- **Documented reconfigure.** Ship release notes plus an in-app notice telling
  every org to re-add delivery in the new UI, and accept a notification gap
  between deploy and reconfigure. Much less code; the gap is real and unbounded,
  and nobody finds out they are in it until an alert they cared about does not
  arrive.

A hybrid is possible: backfill delivery (the silent-failure half) and let silences
lapse with a note, since a silence is time-boxed by construction and its
expiry is already expected.

## Sketch, if backfilling
- Read every org's `alert_settings.delivery` before dropping the table; the drop
  has to come after the backfill in the same migration sequence, not before.
- Map each configured target to a CC channel by kind, then one receiver per org
  named for the org (the managed-receiver naming the branch already uses for
  `everr-default-email` / `everr-default-telegram`), then a catch-all route.
- Make it idempotent and re-runnable: it will be run twice by someone.
- Log per-org what was provisioned, so the gap is auditable afterwards.
- Update `docs/alert-notifications.md` either way. Right now it documents a system
  that no longer exists, which is worse than documenting nothing.

## Related
- [cc-cleanup-pending-migration.md](./cc-cleanup-pending-migration.md) is the other
  migration gap in the same cutover.
- The deletion itself is clean: no dangling imports, worker tasks and cron items
  are unregistered, and typecheck passes. This issue is only about the data left
  behind.
