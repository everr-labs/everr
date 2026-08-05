# One SLO detail page load can exhaust the org's whole SQL quota

## What
The budget-history chart computes its series at read time: one full SLI scan per
plotted point. A single page load therefore issues dozens of ClickHouse queries
against a per-org quota of 120 per 60 seconds, and two loads of a 30d SLO inside
a minute exceed it.

The quota is shared by every SQL API caller for that org, so the failure is not
confined to the chart: once tripped, dashboards, logs, errors and traces all fail
for the remainder of the minute. One page denies service to the rest of the app.

## Where
`packages/app/src/data/cc/slo-series.server.ts`, `querySloBudgetSeries`: N
independent trailing-window scans, spread over the range and run through
`createLimiter(8)`. The point count comes from `getCcSloBudgetSeries`
(`packages/app/src/data/cc/server.ts`), which defaults to 60 and caps at 200.

The quota lives on the `sql_api_quota` ClickHouse quota, keyed per org
(`sql_api_org_<orgId>`).

## Measured (dev stack)

| | queries per page load |
|---|---|
| idle baseline | 0 |
| SLO detail, 7d window | 30 |
| SLO detail, 30d window | 62 |

Quota limits, from `system.quotas_usage`:

| duration | max queries |
|---|---|
| 60s | 120 |
| 3600s | 2400 |

So two loads of a 30d SLO in one minute is 124 against a limit of 120. Observed
in practice: 14 `Quota for user ... has been exceeded` errors from
`everr-dev-app`, peaking at **378 queries against the 120 limit**, produced by
ordinary reload-and-navigate traffic while working on the page.

The hourly limit bites too: 2400 / 62 is about 38 loads of a 30d SLO per hour
for the entire org, across all users.

## Why a cache is the right first move
Every point is already a pure function of `(sliSql, targetPercent, windowSecs,
instant)`. The instants are snapped to a round grid (`chooseStepMs` plus the
`NICE_STEPS_MS` table), explicitly so that the same range yields the same
instants across reloads and polls. That was done for determinism, but it also
makes the results cacheable without any further work: for any instant in the
past, the answer can never change.

Today none of that is exploited. A reload recomputes all 62 scans from scratch,
and two users looking at the same SLO pay for it twice.

Note the distinction from `todo/ideas/slo-sli-rollups.md`: rollups make each
point cheap to compute, a cache makes most points unnecessary to compute. They
compose, and the cache is far less work.

## Sketch
- Cache per point: key on `(sloId, specVersion, instant)`, value the scalar
  `(good, valid)` row. Scrolling the range or changing the point
  count then reuses whatever overlaps instead of missing wholesale.
- Include something that changes when the SLI does (the SLO's `version`, or a
  hash of `sliSql` + `targetPercent` + `windowSecs`), so editing an SLO cannot
  serve numbers computed under the old definition.
- Treat only the trailing point as volatile. Every instant strictly in the past
  is immutable once ingestion has settled; give the final point (which ends at
  "now") a short TTL or skip caching it, and let the rest be long-lived.
- Ingestion delay is the one caveat: a point whose window ends seconds ago can be
  cached before its rows land. The scans already end their windows
  `CC_SLO_INGEST_DELAY_SECS` (default 10s, mirroring the measured 2 to 9 second
  insert delay) before their instant; hold off caching a point until its window
  end is older than that allowance.
- Where the cache lives is open. Redis is already in the stack and would let the
  cost be paid once per org rather than once per process.

## Cheaper mitigations, if the cache is not next
- Lower the default point count from 60. At 30 points a 30d chart is one point
  per day, which is ample for a quantity that moves this slowly, and it halves
  the per-load cost.
- Fetch the chart series lazily, so a page load only pays for it when the chart
  is actually in view.

## Related
Found by checking `everr-dev-app` errors on the dev stack after a session of
work on the SLO detail page. The read-time series is deliberate and documented
(it is what lets a freshly-created SLO show history immediately); what looks
unintended is that its fan-out is billed against a quota sized for single
queries, and that overrunning it takes the rest of the app down with it.
