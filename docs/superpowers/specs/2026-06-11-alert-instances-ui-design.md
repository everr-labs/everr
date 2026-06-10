# Alert Instances, Instance-Scoped Silences, And Alerts UI Split

Date: 2026-06-11

## Summary

This design extends the landed alerting foundation (`2026-06-06-alerting-system-design.md`) in three ways:

1. **Per-row alert instances.** Each row returned by an alert query becomes an alert instance with its own firing/resolved state, identified by labels derived from the row. Notifications stay one per rule per evaluation.
2. **Instance-scoped silences.** Silences are created only from a firing or resolved alert instance and carry Alertmanager-style label matchers, so a silence can target one instance, a label subset, or the whole rule.
3. **Alerts UI restructure.** The single Alerts page splits into a list route (`/alerts`) and a detail route (`/alerts/$alertId`); organization notification settings move into a modal dialog on the list route.

This supersedes the original design's "one alert instance per rule" decision and its non-goal "No per-row alert instances in v1". All other decisions in the original design remain in force.

## Goals

- Track firing/resolved state per query result row (instance), not only per rule.
- Keep notification volume at one message per rule per evaluation.
- Match Grafana's grouped-notification behavior: notify when new instances start firing and when all instances resolve.
- Let admins and owners silence a subset of a rule's instances with label matchers.
- Make the Alerts list and detail separate routes with clean, focused layouts.
- Configure organization notification settings from a modal, not an always-visible card.

## Non-Goals

- No `group_wait` / `group_interval` / `repeat_interval` timing knobs. The evaluation interval is the only pacing.
- No org-wide (cross-rule) silences. Silences stay scoped to one alert definition.
- No per-instance notification routing.
- No Postgres table for instance state. Instance state is derived from ClickHouse `alert_events`.
- No change to apply/CLI flows beyond the optional `spec.instanceLabels` YAML field.

## Instance Model

### Identity

An instance is identified by its **labels**, a string-to-string map derived from a query result row:

- **Implicit default:** every column whose JSON-decoded value is a string becomes a label (`column name -> value`). Columns with numeric, boolean, null, or composite values are evidence values, not labels.
- **Explicit opt-in:** `spec.instanceLabels: [<column>, ...]` in the AlertRule YAML overrides the convention. Listed columns become the labels; everything else is a value. Apply-time validation rejects `instanceLabels` entries not present in the validation result schema (same mechanism as `${top_<column>}` validation). Label values are stringified with `String(value)` when the column is not already a string.
- A row that yields zero labels maps to a single instance with an empty label set. The rule then degenerates to the previous whole-rule behavior.

The **fingerprint** is a stable hash of the canonical label encoding: sort label names, join `name=value` pairs, hash with SHA-256, keep the first 16 hex characters. Empty labels hash the empty string. If multiple rows in one evaluation produce the same fingerprint, the first row (after query ordering) wins and later duplicates are ignored.

The existing evidence bounds (50 rows, 64 KiB) also bound the instance set: only bounded evidence rows produce instances. Truncation is already surfaced via `evidence_truncated`.

### State Storage

Instance state lives in ClickHouse `app.alert_events`, not Postgres. Two new event types:

- `instance_fired`: an instance entered firing.
- `instance_resolved`: a previously firing instance stopped appearing in the query result.

Two new columns on `app.alert_events`:

- `instance_fingerprint String DEFAULT ''`
- `instance_labels_json String DEFAULT '{}'` (JSON object of the instance labels; bounded by the same 64 KiB evidence byte cap, with values dropped wholesale if exceeded)

Instance events also populate `evidence_json` with the instance's own bounded source row (for `instance_fired`) so the UI can show latest values per instance.

The **current firing set** for a definition is derived as: latest instance event per fingerprint (by `event_time`, `argMax`) where that latest event type is `instance_fired`, filtered by `organization_id`, `repoid`, `slug`, and `alert_definition_id`.

Consistency requirements that make this read-modify-write safe:

- `insertAlertEvents` already uses `async_insert: 1, wait_for_async_insert: 1`, so an evaluation's inserts are flushed before the job completes.
- The scanner already enqueues evaluations on a per-organization Graphile Worker queue (`alerts:eval:<org>`), which serializes evaluations within an org; two evaluations of the same definition never run concurrently.
- Evaluation remains at-least-once. A retried evaluation re-derives the firing set and re-computes the diff; replays produce duplicate-but-idempotent instance events (same fingerprint, same direction), which the latest-event derivation tolerates.

Lifecycle is automatic: when an apply changes the query shape, old label sets stop appearing and resolve at the next evaluation. Resolved instances remain visible for the tenant's logs retention window, after which their events expire via TTL.

## Evaluation Flow

`evaluateAlert` replaces the single-state transition with an instance diff:

1. Load the active definition; render and run the query (unchanged).
2. On query error: unchanged behavior (record `evaluation_failed`, update `last_evaluation_*`, no state or instance changes).
3. Bound evidence rows; map rows to instances (fingerprint + labels + source row).
4. Read the previous firing set from ClickHouse.
5. Diff: `newlyFired` (in result, not in previous set), `stillFiring` (in both), `nowResolved` (in previous set, not in result).
6. Insert events in one batch:
   - One `instance_fired` event per `newlyFired` instance.
   - One `instance_resolved` event per `nowResolved` instance.
   - One rule-level `firing` event when `newlyFired` is non-empty (with the full bounded evidence, `row_count` = current result row count).
   - One rule-level `resolved` event when the previous set was non-empty and the new firing set is empty.
7. Update `alert_definitions`: `current_state` = `firing` if the new firing set is non-empty else `resolved`; `firing_instance_count` = size of the new firing set; existing `last_*` fields as today (`last_fired_at` set when `newlyFired` is non-empty and the previous set was empty; `last_resolved_at` when the set empties; `last_seen_at` whenever the set is non-empty).
8. Notify (see below).

### Notification Trigger (Grafana-like, one message per rule)

- **Firing notification:** sent when `newlyFired` minus silenced instances is non-empty. One message per rule per evaluation. Content: rendered `summary` and `description` (rule-level templates, unchanged semantics), the current firing instance count, and up to 10 of the newly fired instances' label sets.
- **Resolved notification:** sent when the firing set empties, subject to the existing `notifyOnResolved` setting. If every instance in `nowResolved` is silenced, the resolved notification is suppressed too.
- New instances joining an already-firing rule **do** re-notify (this is the Grafana `group_interval` behavior, paced by our evaluation interval). Unchanged firing sets never re-notify; there is no repeat interval.
- Delivery outcomes (`sent`, `failed`, `silenced`) are recorded in `alert_events` as today.

## Silences

### Model

`alert_silences` stays rule-scoped (`alert_definition_id` FK kept) and gains:

- `matchers jsonb NOT NULL DEFAULT '[]'`: an array of `{ "label": string, "op": "=" | "!=" | "=~" | "!~", "value": string }`.

Semantics (Alertmanager-compatible):

- A matcher matches an instance by comparing against the instance's label value; a label absent from the instance is treated as the empty string.
- `=~` and `!~` are anchored regular expressions (implicitly wrapped as `^(?:value)$`). Regex validity is checked at creation time; invalid patterns are rejected.
- A silence matches an instance when **all** its matchers match. An empty matcher array matches every instance of the rule.
- An instance is **silenced** when at least one active silence on its rule matches it. Active means `starts_at <= now() < ends_at` and not cancelled (unchanged).
- Silences suppress delivery only. Evaluation, instance transitions, state updates, and event history continue (unchanged principle).

### Delivery Interaction

`deliverAlertNotification` becomes instance-aware:

- For firing: filter `newlyFired` through active silences. If nothing remains, skip sending and record delivery events with outcome `silenced` (with the matching silence id). Otherwise send one message; silenced instances are excluded from the listed label sets.
- For resolved: if all `nowResolved` instances are silenced, record `silenced`; otherwise deliver per `notifyOnResolved`.

### Creation And Cancellation

- Silences are created **only** from an instance row (firing or resolved) on the alert detail route. There is no standalone whole-rule silence form; a whole-rule silence is achieved by removing the pre-filled matchers in the dialog.
- The silence dialog pre-fills one `=` matcher per label of the selected instance, all editable, plus duration (hours) and optional reason.
- `createSilence` gains a validated `matchers` input; authorization (admin/owner) and audit fields are unchanged. `cancelSilence` is unchanged.

## UI

### `/alerts` — List Route

`packages/app/src/routes/_authenticated/_dashboard/alerts.tsx` becomes a pure list:

- One table, one row per rule: slug (link to the detail route), repo, state badge with firing instance count (e.g. `firing · 3`) plus `inactive`/`silenced` badges, last evaluation time, interval, window, source link.
- The `silenced` badge means the rule has at least one active silence.
- Header carries a "Notification settings" button that opens the org delivery settings in a modal `Dialog`: email enabled + recipients, Telegram enabled + chat IDs, notify-on-resolved. Rebuilt with proper `Switch`/`Label`/`Input` components instead of raw checkboxes. Save closes the dialog on success and surfaces errors inline.
- The `?alertId=` search param, inline detail panel, silence card, and settings card are removed.

### `/alerts/$alertId` — Detail Route

New file `packages/app/src/routes/_authenticated/_dashboard/alerts_.$alertId.tsx`, following the `errors_.$fingerprint.tsx` / `traces_.$traceId.tsx` pattern (own breadcrumb back to Alerts, `hideTimeRangePicker`). Layout, top to bottom:

1. **Header:** slug, state badge, repo, source link, deactivate button (admin/owner, unchanged semantics).
2. **Instances table** (primary section): one row per instance — label badges (`name=value`), state badge, fired-at, resolved-at, silenced indicator, latest values from the instance's last `instance_fired` evidence, and a "Silence" row action opening the silence dialog. Firing instances sort first, then by recency.
3. **Definition card:** interval, window, validation status, last evaluation status/error, rendered query.
4. **Active silences card:** matchers, end time, reason, creator, cancel action.
5. **History table:** rule-level events only (`firing`, `resolved`, `evaluation_failed`, `delivery_attempt`); instance events are excluded from this view.

A direct link to a missing/foreign alert id renders a not-found state.

## Storage Changes

ClickHouse (`clickhouse/init/12-create-alert-events.sql`, edited in place since alerting is unreleased; dev environments recreate the table):

- Add `instance_fingerprint String DEFAULT ''` and `instance_labels_json String DEFAULT '{}'` to `app.alert_events`.
- `event_type` gains values `instance_fired` and `instance_resolved` (no DDL change; `LowCardinality(String)`).
- `alert_events_logs_mv` projects the new fields into `LogAttributes` as `alert.instance_fingerprint` and `alert.instance_labels`.
- `ORDER BY`, partitioning, and TTL are unchanged.

Postgres (Drizzle schema only; do not generate migrations — they are created at the user-requested migration step):

- `alert_definitions`: add `firing_instance_count integer NOT NULL DEFAULT 0` so the list route never queries ClickHouse.
- `alert_silences`: add `matchers jsonb NOT NULL DEFAULT '[]'`.

YAML schema:

- `AlertRuleYamlSchema.spec` gains optional `instanceLabels: z.array(NonEmptyStringSchema).nonempty().optional()` (strict object, so unknown fields still fail).

## Module And Data-Layer Changes

- `packages/app/src/server/alerts/instances.ts` (new): label extraction, fingerprinting, firing-set derivation query, instance diffing. Pure functions where possible.
- `packages/app/src/server/alerts/transitions.ts`: replaced by the instance diff; the rule-level transition falls out of set emptiness.
- `packages/app/src/server/alerts/silences.ts` (new) or extension of `delivery.ts`: matcher schema, matcher evaluation, instance-silence filtering shared by delivery and the UI.
- `packages/app/src/server/alerts/evaluate.ts`: new flow as above.
- `packages/app/src/server/alerts/events.ts`: builders for instance events; rule-level builders unchanged.
- `packages/app/src/data/alerts/server.ts`:
  - `listAlerts` adds `firingInstanceCount`.
  - `listAlertInstances` (new): ClickHouse latest-event-per-fingerprint query, bounded (500 instances), firing first.
  - `listAlertEvents` excludes instance event types.
  - `createSilence` accepts and validates `matchers`.
  - `getAlertSettings` / `updateAlertSettings` unchanged.
- Routes: `alerts.tsx` rewritten as list; `alerts_.$alertId.tsx` added; `routeTree.gen.ts` regenerates.

## Testing

Unit:

- Label extraction: implicit string-column convention, explicit `instanceLabels`, zero-label rows, non-string stringification under explicit mode.
- Fingerprint stability: order-independence of label maps, duplicate-fingerprint rows in one result.
- Instance diff: newly fired, still firing, now resolved, empty-to-empty.
- Matcher evaluation: `=`, `!=`, `=~`, `!~`, anchoring, absent label as empty string, empty matcher array, invalid regex rejected at creation.
- Notification trigger: new instances re-notify while already firing; unchanged set does not; all-resolved notifies once; silenced subsets excluded; fully silenced evaluations record `silenced`.
- Event builders include fingerprint and bounded labels JSON.
- YAML schema accepts/rejects `instanceLabels`; apply validation rejects unknown `instanceLabels` columns.

Evaluator (integration-style, mocked ClickHouse):

- Firing-set derivation uses latest event per fingerprint.
- Replayed evaluation (same scheduled time) does not corrupt derived state.
- `firing_instance_count` and `current_state` track the derived set.
- Evaluation failure changes nothing.

Route/data:

- `listAlertInstances` shape and bounds.
- `createSilence` matcher validation and authorization.
- List and detail routes render from prefetched queries; settings modal save round-trip.

## Supersedes

In `2026-06-06-alerting-system-design.md`:

- Non-goal "No per-row alert instances in v1" — replaced by this design.
- Approved decision "One alert instance per rule" — replaced by per-row instances with one notification per rule.
- "Alerts Page" section — replaced by the list/detail split and settings modal described here.
- Silence model — extended with instance matchers; bounded-time semantics, authorization, and audit fields are unchanged.
