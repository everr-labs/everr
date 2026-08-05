# PR #225 review findings (CC-backed alerting cutover)

Five parallel reviews of `feat/clickety-clack-frontend` against `main` (538 files,
~80k insertions), one per area: CC engine core, CC API and storage, app data and
server layer, frontend, infra and docs.

Findings are ranked across all five areas. Items marked **verified** were
reproduced empirically (against the live dev ClickHouse, or by parsing hostile
SQL through `sqlparser 0.51` with `ClickHouseDialect`); the rest are read from
the code.

## Status

**Fixed on the branch:** 1, 2, 3, 6, 7, 8, 9, 11, 13, 14, 17, 19, 20, plus the
stale `docs-content.test.ts` and `layout.shared.test.tsx` (both were already
failing before the review). Their sections below are kept as the record of what
was wrong and why the fix took the shape it did.

**Open, each with its own issue file** (the sections below are the summary; the
file is the working document):

| # | Issue |
|---|---|
| 4 | [alerts-cutover-tenant-migration.md](./alerts-cutover-tenant-migration.md) |
| 5 | [cc-cleanup-pending-migration.md](./cc-cleanup-pending-migration.md) |
| 10 | [dispatcher-suppression-strands-group-membership.md](./dispatcher-suppression-strands-group-membership.md) |
| 12 | [cc-list-endpoints-unbounded.md](./cc-list-endpoints-unbounded.md) |
| 15 | [series-palette-fails-contrast.md](./series-palette-fails-contrast.md) |
| 16 | [slo-budget-chart-unmemoized.md](./slo-budget-chart-unmemoized.md) |
| 18 | [docs-moved-urls-no-redirects.md](./docs-moved-urls-no-redirects.md) |

4 and 5 block merge: both are migration gaps whose consequence is a hard failure
or a silent notification outage on deploy, and both need a product call rather
than a code fix. Update 2026-08-03: 4's code-independent cleanup (truthful
zero-subscriber empty state, stale docs replaced) landed on the branch; the
migrate-vs-reconfigure decision itself is deferred to the issue file, which now
carries the decision query and the recommended hybrid. 10, 12, 15, 16 and 18 are real defects but each is a design
change rather than a correction.

**Everything under "Lower priority" is untouched** and stays in this document. It
is a list of small, independent items rather than tracked work; promote any of
them to its own file when someone picks it up.

The PR description is stale in one respect worth noting up front: there is no
`everr.managed="simple"` marker anywhere in the tree. Ownership moved to
`everr.repoid` plus CC's first-class `name`/`namespace`, and the resulting
scoping is airtight in both reconcilers.

---

## Blockers

### 1. Every ClickHouse resource limit is inert, including `readonly=1` (verified)
`crates/clickety-clack/src/clickhouse/mod.rs:214`

The limits go out as an `X-ClickHouse-Settings` HTTP header. ClickHouse has no
such header: settings must be URL query parameters or a `SETTINGS` clause.
Verified against the running dev ClickHouse (26.2.19.43) with the exact string CC
sends:

```
header form: getSetting -> {"met":0,"mrr":0,"ro":0}   # identical to sending nothing
URL form:    Code 396 TOO_MANY_ROWS_OR_BYTES          # actually enforced
```

So `max_execution_time=10`, `max_rows_to_read`, `max_memory_usage`,
`max_result_rows`, `max_result_bytes`, `result_overflow_mode=throw` and
`readonly=1` are all no-ops on every rule and SLO query.

A tenant rule `SELECT ... FROM numbers(1e12)` (accepted by `sqlguard`) runs with
no execution-time, row, memory or result cap until ClickHouse OOMs.
`query_rows_inner` buffers the whole body with `resp.text()`, so the api and
evaluator process OOMs alongside it.

`docs/how-to/harden-clickhouse-access.md` states that "the per-query `readonly=1`
setting blocks writes". It does not, which leaves only `sqlguard`'s shape check
(bypassable, see finding 8) and the ClickHouse user's grants. The doc comment
reasoning in `sqlguard/mod.rs:29-38` about bounding what the evaluator buffers is
void for the same reason.

The only test of this path (`tests/unit_it/derived_auth_it.rs:78,101`) asserts
the header is *sent*, against an axum mock. It is structurally incapable of
detecting that ClickHouse ignores it.

**Fix:** append the settings to the query string. `build_query_url` already
constructs one.

### 2. A trailing SQL comment makes a rule permanently un-fireable (verified)
`crates/clickety-clack/src/clickhouse/mod.rs:207`

`format!("{sql} FORMAT JSONEachRow")` appends on the same line as the last line
of the SQL, and `sqlguard::validate` accepts trailing comments. Live ClickHouse:

```
SELECT 1 AS n -- daily note FORMAT JSONEachRow  ->  1          (TabSeparated)
SELECT 1 AS n FORMAT JSONEachRow                ->  {"n":1}
```

The multi-line case (last line is a comment) behaves identically. `parse_rows`
then errors on any non-empty TSV body but returns `Ok(vec![])` for an empty one,
so the rule resolves normally when nothing matches and errors out exactly when
rows appear. It can only ever resolve, never fire, which is the worst available
alerting failure mode.

A trailing `;` is also accepted by the guard and yields `SELECT 1; FORMAT
JSONEachRow`, which fails with `Multi-statements are not allowed` on every
evaluation. Both are idiomatic SQL a rule author will write.

**Fix:** append the format on its own line, and reject a trailing `;` in
`sqlguard`.

### 3. Burn-rate tier dedup half-landed: 1-day SLOs can never resolve
`crates/clickety-clack/src/evaluator/slo.rs:835` (with `:337` and `:891`)

`evaluate_slo` builds the snapshot's tier list from
`tiers_for_spec(&slo.spec)` (2 tiers at a 1-day window after `a3c6cb06`), but
`plan_tier_firing` iterates `canonical_tiers()` (always 3). Its comment, "the
canonical list resolves the same set as the SLO's scaled tiers", was true before
the dedup and is now false.

For a 1-day SLO, `payload.tiers.find(name == "fast-burn")` is `None` on every tick,
so `long_burn`/`short_burn` are `None`, so the verdict is `TierVerdict::Unknown`,
and `present_for(Unknown, prev)` is `prev != Inactive`: the last state is held
forever.

Deploy this branch with `demo/demo-always-burning` (1d window) holding a
`slo_tier=fast-burn` instance at `status='firing'`, precisely the state
`a3c6cb06` describes as pre-existing. Every subsequent tick plans a fast-burn
`TierFiring` with verdict `Unknown`, the state machine returns
`EvalOutcome { event: None }` and stamps `last_seen = eval_ts`. The instance can
never resolve: it is not in the `known_by_key` leftover set (it was planned),
`list_stale_slo_instances` never sees it stale, and `update_slo`'s instance
teardown only fires on an objective change. The result is a permanently open
critical alert with no path to close short of manual SQL.

Secondary effect on every 1-day SLO: a phantom `slo_tier=fast-burn` instance row
is upserted forever. Invisible to `list_alerts` (which filters
`status != 'inactive'`), but it is DB churn.

**Coverage gap:** no test drives a 1-day window through `evaluate_slo` or
`plan_tier_firing`. Grepping `1d` and `86_400` across `tests/it/evaluator/` and
`tests/it/stores/slo*.rs` returns nothing; every `tier_firing_tests` case uses a
`"30d"` spec, where the canonical and scaled tier sets coincide and the mismatch
is invisible.

### 4. Existing tenants lose alert delivery silently
No migration anywhere in the branch.

`db/schema/alerts.ts` (`alert_definitions`, `alert_settings`, `alert_silences`)
and `data/alerts/delivery-settings.ts` are deleted;
`clickhouse/init/12-create-alert-events.sql` is gone. There is no migration,
backfill script or doc: `docs/alert-notifications.md` is untouched and now
describes a deleted system.

An org with configured Slack webhooks or Telegram bot tokens in
`alert_settings.delivery` deploys this. The in-process delivery pipeline is gone,
no CC channel or receiver exists for them, and `/alerts/delivery` shows an empty
list. Alerts still fire in CC and land in `app.logs`, but nobody is notified.
Active `alert_silences` are likewise dropped, so anything deliberately muted
starts paging again.

**Fix:** a one-shot backfill (`alert_settings.delivery` to
`cc.createChannel`/`createReceiver` plus a catch-all route), or an explicit and
documented "reconfigure delivery" step in the release notes.

### 5. `cc_cleanup_pending` has no migration
`packages/app/src/db/schema/app.ts:317`, `data/alerts/preview-cleanup.server.ts:269`

Brand new table; `drizzle/meta/_journal.json` ends at `0010_previews`, and prod
runs `drizzle-kit migrate`, not push.

On deploy, the hourly `previews/cc-orphan-sweep` cron calls
`sweepOrphanCcRules()`, whose first statement is
`Promise.all([listPreviewOrgs(), listPendingCleanupOrgs()])`.
`listPendingCleanupOrgs` throws `relation "cc_cleanup_pending" does not exist`,
and unlike `markPending`/`clearPending` that call sits outside any try/catch, so
the whole sweep aborts before visiting a single org. Orphaned suppressed preview
rules are never reaped.

The project convention is not to generate migrations while iterating on the
schema, so this is a pre-merge item rather than a code defect. It is still a hard
runtime failure, not a degradation.

### 6. Trusted-ingest defaults
`collector/config.example.yml:12-14`, `:194-208`, `:49-63`;
`docker-compose.yaml:48-49, 80, 131`

The isolation *design* is correct and was verified: the three `*/public`
pipelines still run `attributes/strip_user_tenant` then `resource/public_tenant`
(which upserts `everr.tenant.id` from `auth.tenant_id`, the value
`app.logs_mv`/`app.traces_mv` actually read), so a client-supplied resource
attribute is unconditionally overwritten; `logs/trusted` and `metrics/trusted`
run `[batch]` only, so CC's per-`ResourceLogs` tenant survives; and 4417/4418 are
deliberately not published in compose. The defaults around that design are the
problem.

**6a.** The trusted bearer token falls back to the literal
`replace-with-a-long-random-trusted-token` when `TRUSTED_INGEST_TOKEN` is unset.
`bearertokenauth` starts happily with it, so a misconfigured deploy has a
working, repo-published credential on the one receiver that performs no strip and
no stamp. If the trusted listener is ever exposed (a shared k8s namespace with no
NetworkPolicy: the config comment at `:65-66` asserts "network policy" as the
control, but nothing in this repo creates one), any client can POST
`ResourceLogs` carrying `everr.tenant.id: <victim-org>` and land rows in the
victim's `app.logs` indistinguishably. Should fail closed on a missing token.

**6b.** The three `*/engine_mirror` pipelines read from `otlp/public` with
processors `[filter/engine_only, batch]`: no strip, no stamp. The file's own
comment at `:163-166` states the invariant that anything reading `otlp/public`
must not trust client-supplied tenant, and these three break it. Any holder of a
valid public ingest key (including a low-trust browser key) can set
`service.name: clickety-clack-anything` plus an arbitrary `everr.tenant.id` and
have it forwarded verbatim. The destination is a dev desktop instance today,
which caps the blast radius, but the pipeline is unconditional in the shared
config.

**6c.** The whole dev block (`otlp/dev` unauthenticated, `resource/dev_tenant`,
`otlphttp/localdev`, the `*/dev` and `*/engine_mirror` pipelines) lives ungated
in the only checked-in source of truth for the production config
(`collector/config.yml` is gitignored). Copied to prod, the collector opens
unauthenticated OTLP on 4319/4320 writing to the same ClickHouse as the public
path, stamped with the literal `replace-with-your-dev-org-id`.

**6d.** `docker-compose.yaml` publishes on all host interfaces: `4319`/`4320`
(unauthenticated OTLP, stamped with `DEV_SELF_TENANT_ID`, which the config
comment says is a real org id), `8088:8080` (CC's `/v1` API gated by the
committed `cc-api-dev-Qr8mXz31TkVfLpN2yBhC`, with `CC_CH_USER: default` and
`CC_DEV_INSECURE_CH_DEFAULT_USER: "1"`, so rule SQL runs with the default user's
privileges and no RLS), and `6379` (Redis, no password). A developer on shared
wifi: anyone who reaches 8088 creates a rule whose SQL is
`SELECT * FROM app.logs` and reads every tenant's data. The fix is one character
per line (`127.0.0.1:8088:8080`).

### 7. `CcRuleSchema` defaults `name` and `namespace` to `""`
`packages/app/src/data/cc/schema.ts:56-57`, `data/alerts/apply.server.ts:324`

Defaulted "for pre-migration CC responses", and the reconciler keys its scope map
by `r.name`.

Deploy the app against a CC that has not run the first-class-name migration,
which is exactly the deploy-order slack the optional `rollup` was added for.
Every rule parses with `name: ""` and `namespace: ""`, so
`existing.filter(isOwnedRule && namespace === "")` keeps all of them, and
`new Map(existing.map(r => [r.name, r]))` collapses them to one entry. The next
`everr apply` then creates a fresh rule for every document (nothing matches by
name) and prunes exactly one of the N legacy rules. The other N-1 keep evaluating
and notifying forever with no way to address them from config: duplicate pages
for every alert.

**Fix:** make `name` required, failing loudly on an un-migrated CC the way
`CcSloSchema.name` does, or refuse to reconcile when any scoped rule has an empty
name.

---

## Should fix in this PR

### 8. The SLO single-statement guard is bypassable (verified)
`crates/clickety-clack/src/api/slos.rs:361-377`, used at `:482`

`strip_ch_params` scans for `{` and `}` without respecting string literals, so a
`{` inside a literal opens a strip span that swallows arbitrary text, including
`;` and whole statements. `validate_slo_spec` returns `Ok` for:

```sql
SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime}
  AND ts < {window_end:DateTime} AND a = '{' ; DROP TABLE t ; SELECT 1 WHERE '}' = ''
```

The stripped form is `... AND a = '0' = ''`, one clean SELECT. The raw form is
three statements, and it is the raw form that gets stored and sent.

The unit test at `:559`
(`strip_ch_params_does_not_let_a_second_statement_through_the_guard`) asserts a
property that does not hold: it only covers the naive `; DROP TABLE t` outside
braces. Note the asymmetry with `sql_without_comments_and_literals`, which does
handle literals correctly for the placeholder check.

ClickHouse's HTTP interface currently rejects multi-statements (verified), so
this is a defeated control rather than proven execution. Nothing in the codebase
pins that behavior, and with finding 1 there is no `readonly` backstop behind it.

### 9. A literal NUL byte in source makes a new file binary to git
`packages/app/src/data/cc/slo-series.server.ts:43`

The group-key separator is an embedded 0x00, so git classifies the file as
binary: `git diff main...HEAD` renders `Bin 0 -> 10494 bytes` and 264 lines of
new server code (the read-time SLO budget series plus its ClickHouse SQL) never
appear in the PR diff, cannot be reviewed, blamed, or merge-resolved. Any tool
that normalizes text can silently drop or mangle the byte and collapse distinct
label groups into one series.

**Fix:** write the separator as an escape sequence, the way `refIdentityKey`
(`data/alerts/schema.ts:108`) already does.

### 10. Ingest-time suppression strands group membership, causing phantom reminders
`crates/clickety-clack/src/dispatcher/mod.rs:243-260`

`process_event` returns `true` (drop and ack) on a silence or inhibition match
*before* `add_to_group`, which is the only thing that clears `fi:{instance}`
(`queue/groups.rs:201-205`).

A warning fires and is delivered into a group whose route sets
`repeat_interval_secs`, so `fi:k` is set. An operator creates a matching silence.
The alert then resolves; the Resolved event is silenced at ingest and dropped, so
`fi:k` is never deleted. The silence expires. `flush_claimed_group`
(`mod.rs:646-663`) now finds `batch.events` empty, `firing_count > 0` and a
reminder due, and re-notifies the receiver about an alert that resolved: every
`repeat_interval`, forever, since no further event for that instance is coming.

The codebase already knows this hazard. `dispatcher/slo_inhibit.rs:68-78` adds an
explicit `status=firing` target matcher so auto-provisioned tier inhibitions
cannot eat a resolve. That guard is missing for user-authored inhibitions and for
silences.

### 11. An empty matcher list silences everything
`crates/clickety-clack/src/api/silences.rs:27-50`, `dispatcher/matching.rs:45`

`POST /v1/silences` performs no matcher validation and `matchers_match(&[], _)`
returns `true`. A client bug that drops the matcher array, or a deliberate
request, blackholes every alert for the tenant with no confirmation and no bound
on `ends_at`. Alertmanager requires at least one matcher on a silence for this
reason. Catch-all is legitimate for routes; it should not be for silences.

### 12. `GET /v1/alerts` is unbounded
`crates/clickety-clack/src/api/alerts.rs:9`, `stores/pg.rs:1286`

No limit, cursor or cap: it `UNION ALL`s both instance tables for the tenant,
sorts the whole result in Postgres and serializes all of it. This is the endpoint
this PR cuts the UI over to. Nothing in `src/evaluator/mod.rs` caps how many
result rows become instances, so one high-cardinality `GROUP BY` rule can mint
100k+ instances per evaluation (and with finding 1, far more).

`GET /v1/rules` got proper keyset pagination with a 500 cap. `/v1/alerts`,
`/v1/silences`, `/v1/routes`, `/v1/receivers`, `/v1/channels`,
and `/v1/inhibitions` did not.

### 13. Preview rows leak into the live alert history
`packages/app/src/data/alerts/history.server.ts:181-186`,
`routes/.../alerts/history.tsx:27`

The event-history query filters only `ServiceName = 'alert' AND ScopeName =
'everr.alerting'`. It never filters `alert.suppressed`, and
`ccQueries.eventHistory(deps.timeRange)` is the one query on the page that is not
preview-scoped (the rules and SLOs beside it are).

Pre-cutover the deleted `app.alert_events` MV routed preview rows to
`ServiceName='alert-preview'`, so the filter excluded them. CC now stamps
`service.name = "alert"` on every record (`otel/exporter.rs:53`), including
suppressed preview-rule evaluations. The live History page therefore interleaves
every open preview's fired and resolved events with production ones,
distinguished only by a small "suppressed" badge
(`alert-event-feed.tsx:229`). During an incident, another engineer's preview
branch pollutes the audit trail.

Same leak in `queryObservedLabelKeys` and `queryObservedLabelValues`
(`:81-92`, `:104-118`): preview-only label keys and values now appear in live
matcher suggestions.

### 14. "Error budget computing" never clears
`packages/app/src/routes/_authenticated/_dashboard/alerts/slos_.$project.$slug.tsx:413`
(message at `:436`)

Gated on `fresh.data !== undefined && fresh.data.length > 0`, not on the query
being in flight, so it never clears when the scan legitimately returns nothing or
errors. An SLO whose SLI query returns no rows in the trailing window
(quiet service, weekend, deploy gap) parks a permanent "Error budget computing"
under its stats row; on a ClickHouse error `fresh.data` stays `undefined`
forever. `querySloBudgetNow` (`data/cc/slo-series.server.ts:109`) returns no
measurement when the query yields zero rows.

**Fix:** key off `fresh.isPending`.

### 15. 51 em and en dash violations on lines added by this branch
Hard project rule (`CLAUDE.md`): no em dashes or en dashes in docs.

```
packages/docs/content/docs/guides/link-alerts-to-runbooks.mdx:6,23,34,62,66
packages/docs/content/docs/guides/publishing-resources.mdx:6,10,45,64,74
packages/docs/content/docs/guides/writing-good-alerts.mdx:3,37,38,39,45,46,47
packages/docs/content/docs/reference/alert-queries.mdx:8
packages/docs/content/docs/reference/cli.mdx:71
packages/docs/content/docs/reference/dashboard-spec.mdx:73
packages/docs/content/docs/reference/runbook-spec.mdx:73
packages/docs/content/docs/reference/visualizations.mdx:8,115,187,215,243,272,274,
  302,331,350,357,372,387,391,407,417,431,435,449,453,466,472,476,486,489,495,504,
  514,518,520
```

`visualizations.mdx` and `variables.mdx` carry roughly 45 further pre-existing
violations on lines inherited from the deleted
`dashboards/panels-and-visualizations.mdx`, including en dashes as literal
default values (`visualizations.mdx:106`) and en-dash ranges (`0-10`, `1-200`,
`0.2-1`). Both files were moved and heavily rewritten here, so they are in scope
for a full sweep. `PRODUCT.md` and `todo/**` are clean.

### 16. Nineteen moved doc URLs with no redirect layer
`packages/docs/src/routes/docs/$.tsx:34` does `if (!page) throw notFound()`, and
there is no redirect layer anywhere in `packages/docs` (no `vercel.json`,
`_redirects` or `nitro.config.*`; `vite.config.ts:39-60` only rewrites
`/docs/*.md`).

Hard 404s: `/docs/alerts`, `/docs/alerts/{alert-spec,notifications,writing-queries}`,
`/docs/dashboards`,
`/docs/dashboards/{organizing-and-sources,panels-and-visualizations,visualizations,dashboard-spec,variables}`,
`/docs/ci-insights/{setup-new-repo,debug-ci,cost-analysis,resource-monitoring,how-ci-cost-is-estimated}`,
`/docs/test-telemetry/{vitest,go-tests,rust-tests}`, and
`/docs/reference/production-telemetry` (moved to `guides/`, and a stable URL the
app itself linked).

Broken in-repo: `CHANGELOG.md:30` and `CHANGELOG.md:41`.

### 17. `cloud-query.alert.yaml` re-fires on every change in the failure mix
`everr/cloud-query.alert.yaml:17-24`

No `instanceLabels` and no `valueColumn`, so identity is inferred from the
query's string-typed result columns: the value of `kinds`, an
`arrayStringConcat(groupUniqArray(...))` aggregate.

ClickHouse starts timing out, `kinds` is `"timeout"`, the alert fires. A minute
later a network error joins in, `kinds` is `"timeout, network"`, a different
fingerprint: the old instance resolves ("recovered") and a new one fires. The
on-call gets a resolve plus a re-fire during an ongoing incident. The
`everr-setup-resources` skill names this exact anti-pattern.

**Fix:** add a constant identity column with `instanceLabels: [<it>]`, and set
`valueColumn: system_errors`.

### 18. Orphaned `alert_events` migration, and no drop for existing clouds
`clickhouse/alter-alert-preview-service.sql`

Still `ALTER TABLE app.alert_events` and recreates `app.alert_events_logs_mv`,
while `clickhouse/init/12-create-alert-events.sql` (which its own header points
at) was deleted. Against a fresh install it fails with `UNKNOWN_TABLE`; against
an old install it resurrects an MV writing the pre-cutover attribute set (no
`alert.severity`, no `alert.suppressed`) into `app.logs`, which the new reader
renders as empty severity.

There is also no counterpart migration dropping `app.alert_events`,
`app.alert_events_logs_mv`, the row policy `tenant_filter_alert_events` or the
`web_app_admin` grants from existing clouds. Historical rows are preserved (they
were already projected into `app.logs`), so this is cleanup debt rather than data
loss, but the dangling MV keeps a write path into `app.logs` that nothing owns.

---

## Lower priority

**CC engine and API**

- `dispatcher/matching.rs:11`: process-global, never-evicted regex cache keyed on
  tenant-controlled strings. Nothing caps silence or route count or pattern
  length, and deleting an expired silence never evicts its entry. One tenant
  OOMs the dispatcher serving every other tenant.
- `evaluator/slo.rs:891`, `:41-54`: the `Unknown` hold has no time bound. When a
  group stops producing rows, every tier is `Unknown` and holds; the group is
  only removed when `budget_due`, and `is_window_due` refreshes at
  `max(base_cadence, window_secs/12)`. A service decommissioned under a 30d SLO
  keeps paging for up to 2.5 days. Pre-`a3c6cb06` it resolved on the next tick.
- `dispatcher/mod.rs:846-859`: a flush whose channels have all vanished drains
  the buffer with no delivery and no dead-letter. `resolve_channels` filters out
  missing names; if that empties the list, `begun`/`sent`/`not_accounted_for` are
  all false and the `else` branch calls `commit_drain`. Compare
  `process_event:335-346`, which correctly dead-letters the analogous case.
- `queue/groups.rs:180,199`: `et:` fields are written per instance and never
  deleted (only `ev:*` is cleared by `commit_drain`), while every add, take and
  arm refreshes the hash `PEXPIRE`. A churny per-pod rule grows the group hash
  without bound, and `TAKE_LUA`'s `HGETALL` pays for it on every flush.
- `dispatcher/retry.rs:30`, `mod.rs:42`: the retry budget is 50+100+200ms, then
  permanent dead-letter, and any reflush of the same active set gets
  `AlreadyHandled`. Slack unreachable for 5 seconds means the page is dropped for
  good.
- `dispatcher/notify.rs:120-128`: every 4xx is Permanent, so 408 and 429 from a
  plain webhook dead-letter on the first attempt. `classify_status_429_transient`
  exists but is wired only to Slack and Telegram.
- `scheduler/mod.rs:101-112`, `:152-163`: `claim_due_*_sharded` advances
  `next_eval` for the whole batch, then the loop returns `Err` on the first
  enqueue failure. The remaining claimed rules skip an entire evaluation cycle.
- `engine/state_machine.rs:106`, `evaluator/mod.rs:123-135`: `maybe_fire` does
  `.expect("active_since set when present")`, but the DB permits
  `(status='pending', active_since=NULL)`. Such a row panics `evaluate`, and the
  `catch_unwind` fallback acks `all_ids`, discarding the whole batch of up to 16
  unrelated evaluations. Every batch it lands in re-panics.
- `clickhouse/auth.rs:90,113`: `server_enforced_limits: true` is hardcoded from
  the auth mode and never verified. Even with finding 1 fixed, `derived` and
  `map` (the modes recommended for untrusted multi-tenant use) omit the app's
  `readonly=1`, while `harden-clickhouse-access.md` step 2 tells operators to
  leave readonly to the app. Each half assumes the other does it.
- `api/rules.rs:357`, `api/slos.rs:249`: `format!("query failed: {e}")` returns
  the raw ClickHouse response body to the caller. `span_error_summary`
  (`clickhouse/mod.rs:67`) strips exactly this from telemetry because CH echoes
  query fragments and server internals; the HTTP path does not.
- `api/rules.rs:341`, `api/slos.rs:210`: `POST /v1/rules/:id/test` ignores `:id`
  and executes the SQL in the body, returning rows synchronously. Under
  `CC_CH_AUTH_MODE=shared` (the default, and what compose uses) all tenants share
  one CH user with no tenant predicate. Intentional and documented, but it is a
  better exfil primitive than a rule and belongs in the hardening guide's threat
  section.
- `sqlguard/mod.rs:17`: the guard ignores `Query::settings`, though sqlparser
  exposes it (`SELECT count() FROM t SETTINGS max_rows_to_read=0` parses and
  passes). Once finding 1 is fixed, a query-level `SETTINGS` clause still
  overrides URL settings unless `readonly=1` blocks it.
- `crates/clickety-clack/.cargo/config.toml`: supplies
  `CC_DEV_INSECURE_NO_AUTH=1` for zero-config `cargo run`, but `85f1f00c` added a
  second fail-closed check without a matching `CC_DEV_INSECURE_CH_DEFAULT_USER=1`.
  With the crate's own defaults, `cargo run` in the `all`, `api` or `evaluator`
  roles now bails at startup. Only `docker-compose.yaml` was updated.
- The migration collapse into a single `0001_init.sql` will checksum-mismatch any
  database that already ran the pre-collapse `0001..0019`, including the running
  `everr-clickety-clack-1` dev stack, crash-looping the container until the dev
  DB is wiped. Production is unaffected (new service to `main`), but it needs a
  deploy-order note.
- `clickhouse/mod.rs:48`: `build_query_url` percent-encodes values but writes
  keys raw. Not exploitable today (keys are hardcoded), but a caller-supplied key
  containing `&` or `=` injects URL query params, including a second `query=`.
- `stores/pg.rs:2526`: `claim_outbox` uses `FOR UPDATE SKIP LOCKED` on
  `self.pool` with no surrounding transaction, so the locks release with the
  implicit transaction and the clause provides no mutual exclusion. Harmless (the
  maintenance lease is the real guarantee) but misleading.
- `api/trace.rs:33`: the module doc says the span name is the matched pattern,
  never the raw path, but the fallback is `req.uri().path()`. 404 probing mints
  one span name per probed path in everr's internal tenant.
- `migrations/0001_init.sql:155`: indexes were deliberately added so the hourly
  prunes do not scan, but `gc_silences` (`stores/pg.rs:2308`,
  `DELETE FROM silences WHERE ends_at < $1`) only has `(tenant, ends_at)`, which
  it cannot use as a prefix. Same reasoning, one table missed.
- `otel/alert_log.rs:111` vs `:132`: `alert.suppressed` is emitted as a string
  while `alert.silenced` is a bool, and `history.server.ts:213-214` compares both
  against `"true"`. It works only because the ClickHouse exporter stringifies
  `AnyValue`.
- `domain/slo.rs:152` contradicts
  `docs/how-to/define-slos-and-burn-rate-alerts.md:123-125` on whether a floored
  tier measures a smaller or larger slice of the budget. The doc is right.

**App and frontend**

- `data/cc/queries.ts:64-69`, `data/cc/server.ts:52-54,149-154`:
  `ccQueries.rules()` polls a sequential unbounded cursor walk every 15s, and
  `listCcAlerts` performs a second full walk on the same cadence. Four pages
  subscribe to both. At 5000 rules that is roughly 80 CC requests per minute per
  open tab just to redraw counts, each under a 10s timeout.
- `alerts/index.tsx:301`, `alerts/slos.tsx:250`: `useQueries` fans out one
  `getCcSloStatus` per SLO, unpaginated, at the 15s poll. The fan-out happens
  before `pageRows` is computed, so pagination does not bound it.
- `components/cc/matchers-editor.tsx:117`: rows keyed by array index while
  `removeMatcher` deletes by index, so an open `SuggestCombobox` popover survives
  the shift and re-binds to a different row's data with the typed search carried
  over.
- `packages/ui/src/components/date-time-picker.tsx:84-90`, `:145`, and
  `components/cc/silences-panel.tsx:293-298`: `setTime` early-returns on an
  unparseable value while the input is controlled from `date`, so the time field
  cannot be cleared once set. No `min`/`max`, and the silence drawer only checks
  both fields are non-empty, so Ends before Starts is submittable and fails with
  a raw server-error toast. DST handling itself is sound.
- `alerts/slos.tsx:388`, `:436`: every row's `CcPauseToggle` receives the same
  `toggle.isPending`, so pausing one SLO greys out all ten buttons.
- `data/cc/queries.ts:109-122,147-160`: `ruleByName`/`sloByName` keys are not
  prefixes of `rules`/`slos`, so list-page pause toggles do not invalidate a
  cached detail entry. Cosmetic today (detail routes invalidate both ways and
  list-to-detail refetches on mount), but an asymmetry waiting to bite.
- `slo-budget-chart.tsx:506`, `:579`: the "reconstructed" `ReferenceArea` label
  and the "applied" `ReferenceLine` label are both `insideTopLeft` and overlap
  when the epoch lands near the left edge.
- `data-utils.ts` `niceLinearDomain`: an all-zero series yields
  `domain: [0, 1e-16]` with a single tick, so the line sits on the axis edge.
- `alerts/triage.tsx:669`: `rules.data` is in a memo's deps but unused inside it.
- `alerts/index.tsx:115-123`: `slosData` (`slos.data ?? []`) as a memo dep makes
  `facts` and `resolveSlo` recompute every render while the query is pending.
- `packages/ui/src/components/tags-input.tsx:88-91`: paste always
  `preventDefault`s and commits, ignoring caret position, so pasting into a
  half-typed draft splits it into two tags; a duplicate typed tag is silently
  swallowed with no feedback.

**Infra, docs and CLI**

- `clickhouse/migrate-errors-udf-app-indexes-otel-ttl.sql:169-178`: step 3 drops
  the only replay source and leaves `otel.*` at 7 days. Nothing outside
  `clickhouse/init/` reads `otel.otel_*`, so no query breaks, but `app.*` is
  populated only by insert-time MVs. If an MV silently fails for 8+ days (a type
  mismatch on a new column fails the MV insert while the raw insert succeeds) the
  gap is unrecoverable. Consider 14 to 30 days, or a documented "verify MV lag
  under 1 day" gate in the file header.
- `packages/telemetry-explorer/src/errors/sql/fingerprint.ts:8` plus
  `clickhouse/init/04-create-error-fingerprint-function.sql`: the Errors read
  path now emits `errorFingerprint(...)`, but `init/04` runs only on a fresh
  server and existing clouds get the function only from the manual migration.
  Nothing enforces ordering, so an app deploy that lands first breaks every
  Errors page and every `everr cloud query` in the `everr-use-telemetry` skill.
- `clickhouse/init/10-create-mvs.sql:90,122-128`: six `bloom_filter(0.01)`
  map indexes across the metrics tables plus `bloom_filter(0.001)` on
  `app.logs`/`app.traces`. Per `query-index-skipping-indices` these are a late
  optimization to validate on real data; at `GRANULARITY 1` the 0.001 filter is
  roughly 14 KB per granule on the two highest-volume tables, and map-value
  blooms only help exact-value equality, which metric queries rarely do. No
  evidence in the PR that these were `EXPLAIN indexes=1` validated.
- `everr/cloud-query.runbook.yaml:35,60,90,118` vs
  `everr/log-pipeline-quality.runbook.yaml:40-41`: `2909f7b6` fixed a real code
  53 failure by wrapping bounds in `parseDateTimeBestEffort`, but applied it to
  one file. The raw-`{from:String}` panels here are fine (`traces.Timestamp` and
  `metrics.TimeUnix` are `DateTime64`), but the rule is documented nowhere:
  `everr-setup-resources/rules/queries.md:41,145` and
  `reference/dashboard-spec.mdx:77` still teach the bare comparison, so the next
  runbook over `logs` reproduces the bug.
- `everr/demo/demo-slow-leak.slo.yaml:44`: `toDateTime('2026-07-18 00:00:00')` is
  hard-coded, and by the file's own arithmetic the fixture permanently reads
  "budget exhausted" from around 2026-08-12. A relative `now() - INTERVAL 11 DAY`
  would be self-maintaining.
- `packages/docs/src/lib/docs-content.test.ts:36-41`: pins `referenceMeta.pages`
  to four entries; `reference/meta.json` now has twelve. Already stale on `main`,
  but this PR reshaped the tree it guards.
- `.agents/skills/add-dashboard-visualization/SKILL.md:184,196` (and the
  `.claude/skills/` copy): points at
  `dashboards/visualizations.mdx` (moved) and
  `dashboards/panels-and-visualizations.mdx` (deleted, no successor).
- `packages/desktop-app/src-cli/src/cli.rs:452-465`: `apply.rs` gained
  `kind: SLO`, but `ResourceKindArg` is still `{Dashboard, Runbook, Alert}`, so
  `everr apply` can create and prune SLOs while `everr resources
  list|show|delete|adopt` cannot address them. The shipped
  `everr-setup-resources` skill has the same gap: no mention of SLOs or
  `*.slo.yaml` anywhere.
- `crates/everr-core/assets/skills/everr-setup-resources/rules/runbooks.md:3`:
  `an\markdown document` (stray backslash, dropped phrase). Line 10 has trailing
  whitespace. Shipped asset that agents read verbatim.
- `crates/everr-core/src/git.rs:56-90`: `normalize_remote_slug` treats any
  `host:path` with no slash before the colon as scp-like, so a Windows remote
  `C:/Users/me/repo` yields repoid `c/users/me/repo` while the POSIX equivalent
  correctly returns `None`. The repoid is the prune boundary, so a wrong one
  silently scopes an apply to the wrong namespace.
- `.fallowrc.jsonc:31-38`: the comment claims both `@opentelemetry/*` entries are
  docs-sample-only. `@opentelemetry/sdk-trace-web` is in no `package.json` (dead
  config), and `@opentelemetry/exporter-trace-otlp-http` is a real declared
  dependency of `packages/app` used at `telemetry/node.ts:10`. Since
  `ignoreDependencies` is global, this permanently suppresses genuine detection
  for a package that uses it.

---

## Verified clean

Worth recording so the next review does not redo it.

- **CC crypto**: AES-256-GCM, fresh `OsRng` 96-bit nonce per call, fresh DEK per
  encrypt, key-id-tagged envelopes so rotation keeps old ciphertexts readable,
  fail-closed factory, tampering tests on both payload and wrapped DEK. Secrets
  never reach `Display` or `Serialize` (`redacted()` on every read path), and
  `From<reqwest::Error>` calls `.without_url()` so credentials cannot land in a
  stored `last_error`.
- **`api/auth.rs`**: SHA-256 digests compared with `subtle::ct_eq`, full scan with
  no early exit, malformed entries dropped while the gate stays enabled, bound
  keys stamp `X-CC-Tenant` before handlers run, `/healthz` and `/readyz`
  correctly outside the layer. Every `/v1` handler calls `tenant(...)` first.
- **Tenant isolation in `stores/pg.rs`**: every read and write on a tenant-owned
  table carries `tenant=$N`. `update_rule`/`resume_rule` take
  `SELECT ... FOR UPDATE` so the read-modify-write is race-free, and
  `RuleUpdate::VersionConflict` gives optimistic concurrency. All 80+ SQL sites
  parameterized, no string interpolation, no cross-tenant leak found.
- **`webhook_url.rs`**: thorough SSRF guard (obfuscated v4 literals, v4-mapped
  and v4-compatible v6, NAT64, CGNAT, benchmarking and IETF ranges) plus
  dispatch-time re-resolution with pinned addresses and no redirects.
- **`migrations/0001_init.sql`**: no destructive steps, composite FK
  `routes(tenant, receiver) -> receivers(tenant, name)` with the referencing-side
  index, cascade deletes on `instances`/`slo_status`/`slo_instances`, unique
  identity indexes on both `rules` and `slos`.
- **Ownership scoping**: `isOwnedRule` (`mapping.ts:284`) requires the annotation
  present and equal, and both the update scope (`apply.server.ts:321-324`) and
  the prune scope (`:441-455`) derive from it plus namespace. An engine-native or
  UI-created rule can only be touched via explicit `--adopt` or the CLI
  resource-admin endpoint. The SLO reconciler mirrors it exactly.
- **No `/alerts` write path can mutate rules**: `data/cc/server.ts` exposes only
  pause and resume, matching the as-code-only decision. Every server fn goes
  through `createAuthenticatedServerFn` and `requireOrgMiddleware`, and every CC
  call passes the active org as `X-CC-Tenant`.
- **Server-fn client-bundle hygiene**: `data/cc/server.ts` exports only server fns
  and erased types; `data/cc/client.ts` is imported exclusively by `*.server.ts`;
  the two component imports of `history.server`/`slo-series.server` are
  `import type`. `CcApiError` was deliberately split into a dependency-free
  module so components can match it across the seroval boundary.
- **`rollup: undefined` is handled** at all three consumers.
- **No prop-syncing `useEffect` anywhere in the diff.** The only new effects are
  error reporting and an unmount-only timer cleanup. Builders remount via `key`
  rather than prop-syncing, and `SilenceCreateDrawer` deliberately uses
  `useImperativeHandle` for the same reason.
- **`severity` is wired end to end**, from `AlertRuleYamlSchema` through
  `CcRuleSpec` to the stamped log attribute and back through
  `toAlertRuleDocument`, with a fallback for pre-severity rows.
- **Deletion completeness**: no dangling imports of `server/alerts/*`,
  `delivery-settings`, `matchers`, `recipients` or `silences`; worker tasks and
  cron items cleanly unregistered; `pnpm typecheck` in `packages/app` passes.
- **Public ingest tenant stamping**: the strip-then-stamp ordering is correct and
  a client-supplied `everr.tenant.id` is unconditionally overwritten.
- **`everrapikeyauth`**: the `(token, origin)` composite cache key is sound, and
  negative-cache and stale-positive-grace paths are keyed consistently.
- **As-code resources**: all three `.slo.yaml` files satisfy `SloYamlSchema`, no
  `spec.tiers` anywhere, every panel `kind` and option used is registered in
  `plugin-specs.ts`, grid layouts `$ref` only panels that exist.
- **Docs accuracy**: zero references to `alert_definitions`, `spec.tiers`,
  in-process evaluation or a non-existent `everr alerts` CLI. All five
  `meta.json` files are internally consistent: no dangling entries, no orphans.
- **Test pruning**: the pruning commits did not cost real behavioral coverage in
  any area reviewed.

---

## Cross-cutting note

Findings 1 and 3 share a shape: a test exists, and it verifies the wrong side of
the boundary. The ClickHouse settings test asserts against an axum mock rather
than a real server, so it cannot see that ClickHouse ignores the header; the tier
tests all use a 30d window, the one window where the two code paths happen to
agree. Finding 8's unit test asserts a property that does not hold. Worth a pass
over what else is only covered that way.
