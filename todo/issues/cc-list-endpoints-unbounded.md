# Five CC list endpoints are unbounded, including the one /alerts polls

From the PR #225 review; see [pr-225-review-findings.md](./pr-225-review-findings.md),
finding 12.

## What
`GET /v1/rules` got proper keyset pagination with a 500-row cap. The rest of the
list surface did not. `GET /v1/alerts` is the sharp one, because the cutover
points the entire `/alerts` UI at it and polls it every 15 seconds.

There is no limit, no cursor, and no cap: the handler unions both instance tables
for the tenant, sorts the whole result in Postgres, and serializes all of it.

## Where
- `crates/clickety-clack/src/api/alerts.rs:9-16`: `list` takes only the tenant and
  calls `state.store.list_alerts(t)` with no bounds of any kind.
- `crates/clickety-clack/src/stores/pg.rs:1286`: `list_alerts` is
  `SELECT ... FROM instances WHERE tenant=$1 AND status != 'inactive'`
  `UNION ALL` the SLO instance table, ordered in Postgres.
- The model to copy: `crates/clickety-clack/src/api/rules.rs:68-79`, which parses
  an optional `limit` (default 100, cap 500) and an opaque `cursor` resume token.

Also unpaginated, in rough order of how much they matter:
`/v1/silences`, `/v1/routes`, `/v1/receivers`, `/v1/channels`, and
`/v1/inhibitions`.

## Failure scenario
Nothing in `crates/clickety-clack/src/evaluator/mod.rs` caps how many result rows
become instances. A single rule with a high-cardinality `GROUP BY` (per pod, per
request id, per customer) mints an instance per group per evaluation.

At 100k instances the `/alerts` overview, triage, delivery and history pages each
poll a response holding all of them, every 15 seconds, per open tab. Postgres
sorts the full set each time. The app deserializes and holds it. The 10 second
`AbortSignal.timeout` on the client starts firing, so the UI degrades to
permanently loading while the queries keep running server-side.

This compounds with the ClickHouse limits having been unenforced (finding 1, now
fixed): before that fix there was no bound on the result rows feeding instance
creation either, so the two failures amplified each other.

## Why it is filed rather than fixed
Pagination is not a local change here. `/v1/alerts` unions two tables with
different natural keys, so a keyset cursor has to be defined over something stable
across both (the instance key plus a tie-break, most likely) rather than reusing
the rules cursor shape. And every consumer changes: the app currently treats the
response as a complete set and computes counts and rollups from it, so a paginated
endpoint either needs a companion count endpoint or the aggregates move
server-side.

That is a design decision about where alert aggregation lives, which is worth
making deliberately rather than bolting a `LIMIT` on and silently truncating what
the overview counts.

## Sketch
- Cap first, paginate second. An unconditional server-side cap with an explicit
  `truncated: true` in the response is a small change that removes the unbounded
  case immediately, and it is honest in a way a silent `LIMIT` is not.
- Then keyset pagination on `/v1/alerts` mirroring `api/rules.rs`: `limit`
  defaulting to 100, capped at 500, and an opaque `next_cursor`.
- Move the count-shaped questions the overview asks (how many firing, by severity)
  to a dedicated aggregate endpoint, so pagination does not make the headline
  numbers wrong.
- Consider a cap on instances per rule per evaluation in the evaluator. That
  bounds the problem at its source rather than at every read, and a rule that
  mints 100k instances is misconfigured in a way worth surfacing to its author.
- The remaining five endpoints are lower volume and can take the simple cap.

## Related
- `crates/clickety-clack/src/dispatcher/matching.rs:11` has the same shape of
  problem on the write side: a process-global, never-evicted regex cache keyed on
  tenant-controlled matcher strings, with nothing capping silence or route count.
- App-side amplification is filed separately in the lower-priority section of the
  review doc: `ccQueries.rules()` and `listCcAlerts` each walk the full rule list
  sequentially every 15 seconds.
