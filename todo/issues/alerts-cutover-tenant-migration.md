# The /alerts cutover silently stops notifications for existing tenants

From the PR #225 review; see
[pr-225-review-findings.md](./pr-225-review-findings.md), finding 4.

## Status (2026-08-03)
The migrate-vs-reconfigure decision is deferred to this issue as a follow-up.
The cleanup both options need already landed on the branch:

- The delivery page's routes empty state is truthful when no route exists
  ("delivered to no one" instead of implying delivery happens).
- `docs/alert-notifications.md` no longer documents the deleted system; it is
  a pointer to the CC-backed docs and to this issue.
- The user guide (`set-up-notifications.mdx`) was corrected in the same pass
  (no PagerDuty channel exists; webhook URLs are redacted too; rotation is an
  in-place channel edit now that secrets are re-entered on edit).

## What the decision needs (findings from the delivery id re-keying work)
- Count the affected orgs before choosing. One query against prod Postgres,
  run BEFORE the deploy that drops the table:

  ```sql
  SELECT count(*) FROM alert_settings
  WHERE delivery->'slack'->>'enabled' = 'true'
     OR delivery->'telegram'->>'enabled' = 'true';
  ```

  A handful of orgs (plausibly just everr's own): documented reconfigure plus
  the now-loud empty state is the honest cheap path. Tens of real orgs: the
  backfill earns its cost.
- The backfill is NOT a SQL migration. Old secrets live in the app's Postgres
  blob; CC encrypts secrets in its own envelope on write. So it is an
  app-side one-shot job that reads each org's `alert_settings.delivery` and
  calls CC's API per org, and it must run before the table drop in the deploy
  sequence.
- There is no provisioning mechanism to piggyback on: nothing in the app
  auto-creates default channels/receivers today (the `everr-default-*` names
  appear only as a naming precedent in a CC test fixture).
- Mapping: each Slack webhook becomes a slack channel; Telegram entries group
  by `botToken` into telegram channels (CC's shape is one token plus a
  `chat_ids` list); one receiver per org; one catch-all route (empty
  matchers), which exactly reproduces the old "everything goes everywhere"
  behavior. CC PUT upserts make the job idempotent for free.
- Silences: old rows reference old `alert_definition_id`s and CC rule
  identities do not map onto them cleanly. Silences are time-boxed by
  construction, so the recommended hybrid is backfill delivery only and let
  silences lapse with a release note.

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
3. `/alerts/delivery` renders its empty state and warns that no alert has a
   delivery path until a route is configured.
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
- `docs/alert-notifications.md` is already updated (see Status above).

## Related
- [cc-cleanup-pending-migration.md](./cc-cleanup-pending-migration.md) is the other
  migration gap in the same cutover.
- The deletion itself is clean: no dangling imports, worker tasks and cron items
  are unregistered, and typecheck passes. This issue is only about the data left
  behind.
