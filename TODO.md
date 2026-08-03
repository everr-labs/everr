# TODO

## Issues

- [**chart-tooltip-content-duplication**](todo/issues/chart-tooltip-content-duplication.md): Chart tooltips are built two incompatible ways across the app: recharts' `ChartTooltip`/`ChartTooltipContent` (fed by `createChartTooltipFormatter`) versus a portaled `CursorTooltip` + chrome-free `SeriesTooltipContent`. They render the same swatch/label/value idea twice; consolidate on one.
- [**slo-short-window-floor-vs-sparse-telemetry**](todo/issues/slo-short-window-floor-vs-sparse-telemetry.md): the floored 60s short window is often smaller than the gaps between rows of the data it measures (in dev, ~12% of eval ticks see an empty trailing 60s window); decide the floor policy: raise `MIN_WINDOW_SECS`, derive the floor from data density, or drop floored tiers instead of evaluating them.

## Ideas

- [**slo-sli-rollups**](todo/ideas/slo-sli-rollups.md): Pre-aggregate simple `countIf`-style SLIs into time-bucketed rollups so budget and burn-rate windows read pre-summed buckets instead of rescanning raw telemetry each evaluation, letting us drop (or relax) the `/12` refresh throttle for those SLOs.
- [**generalize-alerting-components**](todo/ideas/generalize-alerting-components.md): Scored survey of the alerting `-components` folder for pieces worth promoting into `@everr/ui` or app-shared. Top of the list: `CcTableSkeleton` (four hand-rolled copies elsewhere), `Pill`/`LabelSet` chips, and `CcStatusDot` as a `tone.ts` companion; page-intro unification needs a design pass first.
- [**serverfn-org-id-on-context**](todo/ideas/serverfn-org-id-on-context.md): `requireOrgMiddleware` validates `activeOrganizationId` but re-nests it in the session, so ~90 call sites deref `session.session.activeOrganizationId` by hand (and `data/cc/server.ts` grew a private `orgId()` helper called 41 times). Surface `orgId` directly on the middleware context and destructure.
- [**consolidate-datetime-formatting**](todo/ideas/consolidate-datetime-formatting.md): Duration formatting exists five times because ui's `formatDuration` caps at minutes; timestamp handling scatters ~35 hand-picked `toLocaleString` sites and 73 raw `new Date(` parses despite `parseTimestampAsUTC` existing for the ClickHouse no-timezone case. Teach ui the long-span format, add a timestamp formatting family, sweep call sites.
