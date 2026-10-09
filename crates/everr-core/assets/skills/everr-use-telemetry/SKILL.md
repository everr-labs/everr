---
name: everr-use-telemetry
description: Use when investigating production or local behavior with logs, traces, metrics, errors, crashes, slow requests, flaky tests, regressions, missing behavior, stale telemetry, user reports, incidents, or questions that real runtime data can answer.
---

## Startup Access

Before using the everr CLI, request for the smallest sandbox access that lets Everr commands work:

- Filesystem read: `~/Library/Application Support/everr/session.json`, `~/Library/Application Support/everr/session-dev.json`, and their parent directory.
- Local network: `127.0.0.1`, `localhost`, and the ports 54318, 54320, 54418, 54420.
- Production network: `https://app.everr.dev`

If the current tool cannot ask for a blanket permission grant, request scoped command approvals before the first Everr command instead of trying a sandboxed command that is expected to fail.

# Use Telemetry With Everr

Use Everr telemetry before guessing when real traces, logs, metrics, or captured command output can explain behavior. Always check whether telemetry can help before continuing with code-only debugging.

## Critical: Only Raw SQL

The ONLY query command is `everr cloud query "<SQL>"` or `everr local query "<SQL>"`. The only optional flag is `--format` (values: `table`, `json`, `ndjson`).

## Choose The Source

| Question | Use |
| --- | --- |
| Production, deployed services, customer reports, cloud CI history | `everr cloud query "<SQL>"` |
| Local app, dev server, local tests, wrapped command output | `everr local query "<SQL>"` |
| What alerts fired, why, and whether the notification went out | Read `rules/alert-history.md`, then `everr cloud query "<SQL>"` |
| Current CI run, branch status, failed jobs, workflow logs | Use the `everr-working-with-ci` skill |
| Browser or web-app behavior: page views, clicks, web vitals, frontend errors | Read `rules/browser-events.md` for the event and attribute catalog, then query as usual |
| Missing or stale local telemetry | Use the `everr-setup-telemetry` skill |

If an Everr command fails, investigate why: collector stopped, stale app, wrong repo, missing auth, missing import, bad query, or CLI bug. **Follow the error message literally** — if it says run `everr local start`, run that. Do not invent alternative explanations for the error or silently replace real telemetry with guesses.

## Default Workflow

1. Check freshness before diagnosing: query the newest `Timestamp` in the relevant table.
2. State the question telemetry should answer.
3. Pick cloud or local data based on where the behavior happened.
4. Discover what data exists: read `rules/schema.md`, then list the services and attribute keys that actually exist before assuming conventions.
5. Start broad, then narrow by service, time range, severity, trace id, span name, run id, branch, route, endpoint, or attributes.
6. Use traces for flow and latency; use logs for errors and discrete facts; use metrics for rates and resource changes.
7. Pivot between logs and traces with `TraceId`.
8. If the data is empty, stale, or missing the needed field, treat instrumentation as the next problem to solve.
9. Explain what the data shows and what remains unknown.

## Schema And Queries

**Read `rules/schema.md` before your first query.** It lists the tables, columns, units, value spellings (`SpanKind`, `StatusCode`), how to read JSON attributes, the query rules, and starter queries: freshness, span names, errors, a full trace by id, and error fingerprints. The same tables exist on cloud and local, except `alert_events`, which is cloud only (read `rules/alert-history.md` before querying it).

Cloud queries time out after 30 seconds and fail past 25,000 result rows or 4 MB of result. They fail; they do not truncate.

## Error Troubleshooting

| Error | Action |
| --- | --- |
| `telemetry collector isn't running` | Run `everr local start` or open Everr Desktop |
| `can't reach the telemetry collector because local network access is blocked` | Allow local network access for the tool or run the command outside the sandbox |
| `telemetry collector is busy` | Wait a moment and retry |
| `no active session` | Run `everr cloud login` |
| `Session expired` | Run `everr cloud login` |

When a local query fails, always run `everr local status` to diagnose the collector state before trying workarounds.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Inventing subcommands or flags (`query traces`, `--filter`, `--window`) | Only `everr cloud query "<SQL>"` or `everr local query "<SQL>"` with optional `--format`. Everything else is in the SQL. |
| Writing queries without a time window | Always add `WHERE Timestamp > now() - INTERVAL N HOUR/MINUTE`. |
| Writing cloud queries without LIMIT | Cloud fails past its result cap (see Schema And Queries). Always include `LIMIT`. |
| Assuming attribute names without discovering them | List the keys first (see `rules/schema.md`). Conventions vary. |
| Getting "collector isn't running" but not running `everr local start` | Follow the error message literally. |
| Diagnosing without checking freshness | Query `max(Timestamp)` first. If data is hours old, it's stale. |

## Integrated Examples

For "production users are seeing errors":
1. Query cloud logs for recent errors with a time window.
2. Pick a representative `TraceId` and query cloud traces for the full request.
3. Compare errors by service, route, version, or deploy-related attributes if available.
4. Explain whether the data points to one service, one path, one release, or a broad outage.

For "my local request is slow":
1. Run `everr local status`. If stopped, run `everr local start`.
2. Check freshness: `SELECT max(Timestamp) FROM traces`.
3. Query recent slow spans from `traces`.
4. Pick the slowest `TraceId` and query the full trace in timestamp order.
5. If spans are missing around the slow boundary, use `everr-setup-telemetry` to add the next targeted signal.

For "debug this failing local test":
1. Check whether the test or app emits logs, traces, metrics, or wrapped command output.
2. If yes, rerun the test and query fresh local logs or traces with a filter for the test name or run id.
3. If no useful telemetry exists, add targeted debug telemetry or explain why telemetry cannot help and debug with the test output and code path.
