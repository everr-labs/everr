# CI trace diff

Compare the traces an app emits under a fixed workload with the traces
the same workload produced on `main`, and report what changed at runtime:
new or removed calls, more calls per request, new errors. The first
version is on PR #582 (draft). It is informational: it writes the diff to
the job summary and never fails the build.

The workflow is disabled: it lives at
`.github/workflows/trace-diff.yml.disabled`, which GitHub does not run.
Rename it back to `trace-diff.yml` to turn it on.

## What exists

- `everr ci trace-snapshot --out run.parquet [--from --to]` saves the
  local collector's spans for a time window to a zstd Parquet file, written
  by chDB through the collector's SQL endpoint. It keeps durations, status
  messages and attributes the diff does not use yet, so baselines recorded
  now still work for later comparisons.
- `everr ci trace-diff --base <file>... [--head <file>]` runs one chDB
  query over the head (the live `traces` table by default) and every
  baseline, and counts spans per trace for each entry point. The entry
  point of a trace is its root span, or its earliest span when the root
  was not exported. Rust then classifies the results:
  - several baselines give a min to max range per rate;
  - a rate counts as changed only when it leaves that range by more than
    `--tolerance` (default 5%, relative);
  - a span appearing or disappearing always counts.

  Output is markdown (also appended to `$GITHUB_STEP_SUMMARY`) or JSON.
  `--fail-on <kinds>` exits non-zero, and `--ignore-span <name>` drops
  spans whose count depends on timing.

- `.github/workflows/trace-diff.yml.disabled` builds the CLI and the self-hosted
  app, then runs `scripts/trace-diff/run.sh`. The script starts fresh
  Postgres and ClickHouse from `scripts/dev/compose.yaml`, migrates, runs
  the built app with its telemetry going to the local collector, and drives
  it with headless Chromium (`scripts/trace-diff/workload.ts`: setup, 3
  passes over 8 pages, sign-in). It then snapshots and uploads the snapshot
  as an artifact. Pull requests diff against the last 3 successful `main`
  runs, or against the branch's own earlier runs while `main` has none. It
  also runs on drafts.

## What we learned

- **Noise.** Two runs of identical code, locally and on separate CI
  runners, report no changes once two things are handled:
  - `tcp.connect` is ignored, because its count depends on connection
    reuse;
  - small drift is tolerated. Entry points where one trace differs from the
    rest (for example the one request before sign-in) have a rate of
    (n - 1) / n, which moves with the number of requests: 0.969 against
    0.968 between two CI runs. The 5% tolerance absorbs that. The price is
    that a real change touching under 5% of an entry point's traces is
    hidden unless `--tolerance 0` is passed.
- **Caught.** A planted duplicate `auth.api.getSession` call in
  `getActiveOrgPolicy` showed up in the right entry point: every span of
  the session lookup went from 1 to 2 per request.
- **Missed.** A planted duplicate Drizzle query in
  `getActiveOrganizationAccess` was invisible. The production build
  bundles `pg`, so auto-instrumentation never patches it and Drizzle
  queries have no spans. Better-auth's adapter spans (`db findOne ...`) are
  the only database spans today.
- **Cost.** About 8 minutes per run on `blacksmith-4vcpu-ubuntu-2404`:
  roughly 3 to build the CLI from source and 3 for the workload.
  Snapshots are about 110 KB for about 3,000 spans.
- **It reports changes, not bugs.** Any feature that adds a call on a
  covered path shows up. Gating on every change kind would fail most
  feature work, so the gate has to involve stated intent (see below).

## To finish

1. **Gate policy.** Fail on `errors-increased`, which is almost never
   intended. For other changes, require either a PR label or declared
   expectations (see "Agents"). Possibly add a rule for large jumps (for
   example 3x or more calls per request), which is the usual shape of an
   N+1 query.
2. **Trace database queries.** Make `pg` visible to the app's
   instrumentation in the production build: mark it external in the Nitro
   build, or register its instrumentation in a way that survives bundling.
   Without this the diff misses the most common regression of this kind.
3. **Readable findings.** Group a span's descendants under it, so one
   duplicated call is one finding rather than 9 rows. Attach a sample base
   and head trace ID to each change.
4. **End-to-end test** in `packages/cli/tests`, modelled on
   `telemetry_query_e2e.rs`: two snapshots with a known difference, then
   check the report and the exit code. Today the SQL is verified by hand
   only.
5. **Docs.** An entry in `packages/docs/content/docs/reference/cli.mdx`,
   and a section in `skills/everr-working-with-ci/SKILL.md` (use `everr`,
   never `everr-dev`).
6. **Release.** `.changeset/ci-trace-diff.md` is a minor bump that ships
   both commands. Once released, replace the build-from-source step with
   the Everr Action's `install-cli` input, which saves about 3 minutes per
   run.
7. **Baselines.** Decide between the latest `main` runs (today) and the
   merge-base. Artifacts from `main` are kept 30 days, so a quiet
   repository can run out of baselines.
8. **Workload.** Agree on the journeys it covers. Any change to the
   workload shows up as a change in every diff until `main` catches up, so
   it should change rarely and deliberately.

## Agents

What would make this useful to coding agents, roughly in order of value:

- **Explain each change.** Sample trace IDs and subtree grouping (item 3
  above), plus a code location. The OTel `code.function.name`,
  `code.file.path` and `code.line.number` attributes would let a finding
  point at the line that added a call. The app does not set them yet.
- **Declared expectations instead of a label.** The pull request states
  the runtime changes it intends, for example in a fenced block in its
  description:

  ```trace-diff
  expect:
    - entry: GET /_serverFn/listDashboards
      new-span: orders-db Client "SELECT dashboards"
  ```

  The check fails on changes that were not declared (unintended side
  effects) and on declared changes that did not happen (a feature not
  wired up). An agent cannot pass it by adding a label without looking.

- **No file handling.** `everr ci trace-diff --base main` would find the
  latest `main` snapshots itself, so an agent can check its change locally
  with one command before pushing. A page filter on the workload would
  shorten that loop.
- **A skill section and, later, an MCP tool.** The app already serves MCP
  (`packages/app/src/routes/mcp`). Once baselines live in Everr Cloud, a
  trace diff tool there needs no CLI at all.

## To explore

- **Cloud source.** The baseline already exists as raw spans in
  ClickHouse, so the same aggregation SQL applies with a different source.
  CI cannot query Cloud yet: `/api/cli/*` accepts only a session, and API
  keys have only the `ingest` and `apply` scopes. This would need a read
  scope for SQL.
- **Latency.** Stored baselines come from different runners, so timing is
  not comparable. A same-runner mode (build and run base and head in one
  job) could compare self-time distributions, at about twice the cost.
- **Profiles.** Same cohorts, with samples aggregated per stack frame and
  normalized per request. Samples that carry span IDs would let the report
  say "this span got slower, and these functions grew". The local store
  has a profiles exporter; whether the cloud pipeline keeps profiles and
  their span links has not been checked.
- **Cloud product.** The workflow covers the self-hosted app only.
  `packages/cloud` would need its own workload (sign-up instead of setup).

## Open questions

- Snapshot files have no version. A future column change has to stay
  readable by `file()` with missing columns, or add a version.
- `toJSONString` of the attribute columns nests dotted keys
  (`{"service":{"name":"api"}}`). Reading them back as JSON gives the same
  paths, but attribute diffs need to account for it.
- The collector writes and reads snapshot files itself, so it must share
  a filesystem with the CLI. Its SQL endpoint also accepts any statement,
  including file writes. That predates this work, but this work relies on
  it.

## Running it locally

Build the app (`pnpm --filter @everr/app build`) and the CLI
(`pnpm dev:cli`), start the local collector, and install `playwright-core`
somewhere outside the workspace. Then:

```bash
export PLAYWRIGHT_DIR=/path/to/dir/with/playwright-core
export CHROME_PATH=/path/to/chrome   # optional; defaults to Playwright's Chromium
scripts/trace-diff/run.sh /tmp/base.parquet
# change the app, rebuild it, then
scripts/trace-diff/run.sh /tmp/head.parquet
everr ci trace-diff --base /tmp/base.parquet --head /tmp/head.parquet --ignore-span tcp.connect
```

`run.sh` sends the app's telemetry to the debug collector's OTLP port
(`http://127.0.0.1:54318`) by default and runs `everr` from `PATH`. With
the debug CLI from `pnpm dev:cli`, set `EVERR=target/debug/everr`. With a
release CLI, set `OTLP_ENDPOINT=http://127.0.0.1:54418`, as the workflow
does.
