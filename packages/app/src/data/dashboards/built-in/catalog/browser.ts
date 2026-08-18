import { ALL_VALUE } from "../../interpolate";
import type { Variable } from "../../schema";
import {
  bar,
  gauge,
  layout,
  split,
  stat,
  table,
  thresholds,
  timeSeries,
} from "../build";
import type { BuiltinDashboard } from "../types";
import {
  BUCKET,
  needsLogAttribute,
  needsLogs,
  OF_SERVICE,
  SERIES_BUCKET,
  serviceVariable,
  topSeries,
  WITHIN,
} from "./shared";

/** Browser records are Logs; the SDK's own attributes live in LogAttributes. */
const attr = (key: string) => `LogAttributes['${key}']`;
const ROUTE = `coalesce(nullIf(${attr("everr.route.pattern")}, ''), ${attr("url.path")})`;

/**
 * "This record came from a browser". The SDK stamps its own distro name on
 * every resource it exports, which is the only filter that catches all of it:
 * an `exception` or a `browser.web_vital` is not identifiable from `EventName`
 * alone, and session-level panels have to count every record in the session,
 * not just the page views.
 */
const FROM_BROWSER = `ResourceAttributes['telemetry.distro.name'] = '@everr/otel-web'`;

/**
 * PostHog's autocapture, in this SDK's spelling: clicks, rage clicks, form
 * changes and submits all share the `everr.browser.interaction.` prefix. Used
 * by the bounce-rate definition, which requires a session to have none.
 */
const IS_AUTOCAPTURE = `startsWith(EventName, 'everr.browser.interaction.')`;

/** Browser name and major version, read out of the resource's user agent. */
const UA = `ResourceAttributes['user_agent.original']`;
const BROWSER_NAME = `multiIf(position(${UA}, 'Headless') > 0, 'Headless Chrome', position(${UA}, 'Edg/') > 0, 'Edge', position(${UA}, 'Firefox/') > 0, 'Firefox', position(${UA}, 'Chrome/') > 0, 'Chrome', position(${UA}, 'Safari/') > 0, 'Safari', 'Other')`;
const BROWSER_VERSION = `extract(${UA}, '(?:Edg|Firefox|Chrome|Version)/([0-9]+)')`;

/** The vital's numeric value, and the name that selects which vital it is. */
const VITAL_VALUE = `toFloat64OrZero(${attr("browser.web_vital.value")})`;
const VITAL_NAME = attr("browser.web_vital.name");
const RATING = attr("everr.browser.web_vital.rating");

/**
 * Millisecond vitals above a minute are instrumentation artifacts, not
 * experiences: a backgrounded or suspended tab keeps the timer running, so the
 * value reported on restore is how long the tab was closed. This window holds
 * an 857,360,376 ms INP -- nine days -- and six such samples in total, enough
 * to put the Y axis of every millisecond panel in the millions.
 *
 * The ceiling therefore guards every panel that *averages* a value. The rating
 * panels deliberately go without it: they count samples rather than combine
 * them, so an outlier cannot distort them, and it is worth seeing that the SDK
 * rated it poor. CLS is exempt because it is unitless -- 60000 is not a
 * quantity it can have.
 */
const SANE_VITAL = `(${VITAL_NAME} = 'cls' OR ${VITAL_VALUE} <= 60000)`;

/**
 * The published Core Web Vitals bands, as a gauge's thresholds. Unlike the
 * shared `thresholds` helper the steps carry their qualitative name, because
 * on a vital the band *is* the reading: 2.6s means nothing to a reader who
 * does not already know that good ends at 2.5s. The axis runs a third past the
 * poor bound so the poor band is a visible stretch of track rather than the
 * right-hand edge.
 */
const vitalBands = (needsImprovement: number, poor: number) => ({
  mode: "absolute" as const,
  defaultColor: "#22c55e",
  defaultName: "Good",
  steps: [
    { value: needsImprovement, color: "#f59e0b", name: "Needs improvement" },
    { value: poor, color: "#ef4444", name: "Poor" },
  ],
});

/** The route picker's selection, or every route when it is All. */
const OF_ROUTE = `${ROUTE} IN $route`;

/**
 * Every web-vitals query is read through both pickers. A vital only means
 * something next to the page it was measured on, so scoping is not a
 * convenience here: a P75 mixed across a marketing page and an app screen is a
 * number no one can act on.
 */
const SCOPED = `${WITHIN} AND ${OF_SERVICE} AND ${OF_ROUTE}`;

/**
 * The routes that actually carry vitals, so the picker never offers a route
 * whose selection empties the dashboard.
 */
const routeVariable: Variable = {
  kind: "ListVariable",
  spec: {
    name: "route",
    display: { name: "Route" },
    allowMultiple: true,
    allowAllValue: true,
    defaultValue: ALL_VALUE,
    sort: "alphabetical-asc",
    plugin: {
      kind: "ClickHouseSQLVariable",
      spec: {
        query: `SELECT DISTINCT ${ROUTE} AS route FROM logs
WHERE ${WITHIN} AND ${FROM_BROWSER} AND ${ROUTE} != '' ORDER BY route`,
      },
    },
  },
};

/**
 * The colors Google uses for the vital ratings in PageSpeed Insights and the
 * web-vitals extension. Readers meet these three greens/ambers/reds wherever
 * else they look at their vitals, so a rotating palette here would cost them
 * the recognition for nothing.
 */
const VITAL_RATING_COLORS = {
  good: "#0cce6b",
  "needs-improvement": "#ffa400",
  poor: "#ff4e42",
};

/** P75 of one vital over the whole window — the statistic the bands are defined on. */
const vitalP75 = (vital: string, decimals: number) =>
  `SELECT round(quantile(0.75)(${VITAL_VALUE}), ${decimals}) AS p75
FROM logs
WHERE ${SCOPED} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = '${vital}'`;

/**
 * One vital's median, P75 and P90 in a single chart. Three quantiles of the
 * same vital say what one P75 line cannot: whether a bad P75 is the whole
 * audience drifting (the three lines rise together) or a slow tail dragging it
 * (P90 pulls away while the median holds).
 */
const vitalQuantiles = (vital: string, decimals: number) =>
  `SELECT ts, q.2 AS series, q.3 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
         round(quantile(0.5)(${VITAL_VALUE}), ${decimals}) AS p50,
         round(quantile(0.75)(${VITAL_VALUE}), ${decimals}) AS p75,
         round(quantile(0.9)(${VITAL_VALUE}), ${decimals}) AS p90
  FROM logs
  WHERE ${SCOPED} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
    AND ${VITAL_NAME} = '${vital}'
  GROUP BY ts
)
ARRAY JOIN [(0, 'Median', p50), (1, 'P75', p75), (2, 'P90', p90)] AS q
ORDER BY ts, q.1`;

/**
 * One vital's ratings as a share of its samples per bucket. Each vital gets
 * its own panel because they are rated on unrelated scales: a shared stack
 * would let a healthy CLS hide a failing INP inside the same green band.
 */
const ratingShare = (vital: string) =>
  `SELECT ${SERIES_BUCKET()} AS ts, ${RATING} AS rating, count() AS samples
FROM logs
WHERE ${SCOPED} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = '${vital}'
GROUP BY ts, rating
ORDER BY ts, indexOf(['good', 'needs-improvement', 'poor'], rating)`;

/**
 * A vital's attribution phases as one stacked chart. Each phase is a separate
 * attribute on the same record, so they are read as columns and unpivoted --
 * a fixed, small series count that never approaches the row cap.
 */
const phaseBreakdown = (
  vital: string,
  phases: ReadonlyArray<[label: string, attribute: string]>,
) => {
  const alias = (index: number) => `phase_${index}`;
  const columns = phases
    .map(
      ([, attribute], index) =>
        `       round(quantile(0.75)(toFloat64OrZero(${attr(`everr.browser.web_vital.${vital}.${attribute}`)}))) AS ${alias(index)}`,
    )
    .join(",\n");
  // The tuple carries the phase's position so the ordering can be explicit:
  // `ORDER BY ts` alone leaves the rows of one bucket in whatever order the
  // pipeline emits them, and the chart stacks its series in first-seen order --
  // which would let the stack come out upside down between two loads.
  const pairs = phases
    .map(([label], index) => `(${index}, '${label}', ${alias(index)})`)
    .join(", ");
  return `SELECT ts, phase.2 AS series, phase.3 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
${columns}
  FROM logs
  WHERE ${SCOPED} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
    AND ${VITAL_NAME} = '${vital}'
  GROUP BY ts
)
ARRAY JOIN [${pairs}] AS phase
ORDER BY ts, phase.1`;
};

export const browserBuiltins: BuiltinDashboard[] = [
  {
    id: "web-vitals",
    name: "Web Vitals",
    description:
      "The Core Web Vitals at P75 against their published good/poor bands, how each one moves at the median, P75 and P90, what the slow ones were waiting on, and the routes and elements responsible. Scoped by service and route.",
    category: "Browser",
    requires: [needsLogs, needsLogAttribute("browser.web_vital")],
    document: {
      kind: "Dashboard",
      metadata: { name: "web-vitals" },
      spec: {
        display: { name: "Web Vitals" },
        duration: "24h",
        variables: [serviceVariable("logs"), routeVariable],
        refreshInterval: "5m",
        panels: {
          lcp: gauge(
            "LCP P75",
            {
              unit: "ms",
              decimals: 0,
              min: 0,
              max: 5300,
              thresholds: vitalBands(2500, 4000),
              variant: "horizontal",
              showAxis: false,
              showThresholdLabels: true,
            },
            vitalP75("lcp", 0),
          ),
          inp: gauge(
            "INP P75",
            {
              unit: "ms",
              decimals: 0,
              min: 0,
              max: 700,
              thresholds: vitalBands(200, 500),
              variant: "horizontal",
              showAxis: false,
              showThresholdLabels: true,
            },
            vitalP75("inp", 0),
          ),
          cls: gauge(
            "CLS P75",
            {
              decimals: 3,
              min: 0,
              max: 0.35,
              thresholds: vitalBands(0.1, 0.25),
              variant: "horizontal",
              showAxis: false,
              showThresholdLabels: true,
            },
            vitalP75("cls", 3),
          ),
          ttfb: gauge(
            "TTFB P75",
            {
              unit: "ms",
              decimals: 0,
              min: 0,
              max: 2400,
              thresholds: vitalBands(800, 1800),
              variant: "horizontal",
              showAxis: false,
              showThresholdLabels: true,
            },
            vitalP75("ttfb", 0),
          ),
          "lcp-rating": bar(
            "LCP by rating",
            {
              showLegend: true,
              stacking: "percent",
              colors: VITAL_RATING_COLORS,
            },
            ratingShare("lcp"),
          ),
          "inp-rating": bar(
            "INP by rating",
            {
              showLegend: true,
              stacking: "percent",
              colors: VITAL_RATING_COLORS,
            },
            ratingShare("inp"),
          ),
          "cls-rating": bar(
            "CLS by rating",
            {
              showLegend: true,
              stacking: "percent",
              colors: VITAL_RATING_COLORS,
            },
            ratingShare("cls"),
          ),
          "lcp-over-time": timeSeries(
            "LCP over time",
            { showLegend: true, unit: "ms" },
            vitalQuantiles("lcp", 0),
          ),
          "inp-over-time": timeSeries(
            "INP over time",
            { showLegend: true, unit: "ms" },
            vitalQuantiles("inp", 0),
          ),
          "cls-over-time": timeSeries(
            "CLS over time",
            { showLegend: true },
            vitalQuantiles("cls", 3),
          ),
          "lcp-phases": timeSeries(
            "What LCP was waiting on",
            { showLegend: true, stacked: true, unit: "ms" },
            phaseBreakdown("lcp", [
              ["Time to first byte", "time_to_first_byte"],
              ["Resource load delay", "resource_load_delay"],
              ["Resource load duration", "resource_load_duration"],
              ["Element render delay", "element_render_delay"],
            ]),
            "Each phase is its own P75, so the stack runs taller than LCP P75: read which phase dominates, not the total. A text element loads no resource, so its two middle phases are zero.",
          ),
          "ttfb-phases": timeSeries(
            "What TTFB was waiting on",
            { showLegend: true, stacked: true, unit: "ms" },
            phaseBreakdown("ttfb", [
              ["Waiting", "waiting_duration"],
              ["Cache", "cache_duration"],
              ["DNS", "dns_duration"],
              ["Connection", "connection_duration"],
              ["Request", "request_duration"],
            ]),
            "Each phase is its own P75, so read which phase dominates rather than the total. Waiting covers redirects and service-worker startup, before the network is touched.",
          ),
          "slow-interactions": table(
            "Slowest interactions",
            `SELECT ${attr("everr.element.selector")} AS element,
       coalesce(
         nullIf(${attr("everr.browser.interaction.name")}, ''),
         ${attr("everr.browser.interaction.type")}
       ) AS event,
       round(quantile(0.75)(toFloat64OrZero(${attr("everr.browser.interaction.input_delay")}))) AS input_delay_p75_ms,
       count() AS samples,
       ${ROUTE} AS route
FROM logs
WHERE ${SCOPED} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = 'inp'
  AND ${attr("everr.element.selector")} != ''
GROUP BY element, event, route
ORDER BY input_delay_p75_ms DESC
LIMIT 25`,
            "Input delay is the wait before the handler even runs: a busy main thread, not slow handler code. Records from an SDK older than the one that stamps the event name fall back to the interaction type.",
          ),
          "lcp-elements": table(
            "Slowest LCP elements",
            `SELECT ${attr("everr.browser.web_vital.lcp.target")} AS element,
       round(quantile(0.75)(${VITAL_VALUE})) AS lcp_p75_ms,
       count() AS samples
FROM logs
WHERE ${SCOPED} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = 'lcp'
  AND ${attr("everr.browser.web_vital.lcp.target")} != ''
GROUP BY element
HAVING samples >= 5
ORDER BY lcp_p75_ms DESC
LIMIT 25`,
            "The element that actually painted last, as a CSS path.",
          ),
          "cls-elements": table(
            "Biggest layout shifts",
            `SELECT ${attr("everr.browser.web_vital.cls.largest_shift_target")} AS element,
       round(quantile(0.75)(toFloat64OrZero(${attr("everr.browser.web_vital.cls.largest_shift_value")})), 3) AS shift_p75,
       ${attr("everr.browser.web_vital.cls.load_state")} AS load_state,
       count() AS samples
FROM logs
WHERE ${SCOPED} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = 'cls'
  AND ${attr("everr.browser.web_vital.cls.largest_shift_target")} != ''
GROUP BY element, load_state
ORDER BY shift_p75 DESC
LIMIT 25`,
            "The single largest shift of each sample, and how far the page had loaded when it moved.",
          ),
        },
        layouts: layout([
          split(4, "lcp", "inp", "cls", "ttfb"),
          split(9, "lcp-rating", "inp-rating", "cls-rating"),
          split(9, "lcp-over-time", "inp-over-time", "cls-over-time"),
          split(9, "lcp-phases", "ttfb-phases"),
          split(9, "lcp-elements", "cls-elements"),
          split(9, "slow-interactions"),
        ]),
      },
    },
  },

  {
    id: "product-analytics",
    name: "Product Analytics",
    description:
      "PostHog's five web-analytics numbers over browser events: visitors, sessions, views, session length and bounce rate, then the paths, referrers and browsers behind them.",
    category: "Browser",
    requires: [needsLogs, needsLogAttribute("everr.page_view.id")],
    document: {
      kind: "Dashboard",
      metadata: { name: "product-analytics" },
      spec: {
        display: { name: "Product Analytics" },
        duration: "24h",
        variables: [serviceVariable("logs")],
        refreshInterval: "5m",
        panels: {
          visitors: stat(
            "Visitors",
            { calculation: "last" },
            `SELECT uniqExact(${attr("everr.visitor.id")}) AS visitors
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND ${FROM_BROWSER} AND EventName = 'everr.browser.page_view'`,
            "Distinct visitor ids.",
          ),
          sessions: stat(
            "Sessions",
            { calculation: "last" },
            `SELECT uniqExact(${attr("session.id")}) AS sessions
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND ${FROM_BROWSER} AND EventName = 'everr.browser.page_view'`,
            "30-minute idle timeout.",
          ),
          "page-views": stat(
            "Page views",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS views
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND EventName = 'everr.browser.page_view'
GROUP BY ts
ORDER BY ts`,
            "SPA route changes included.",
          ),
          "session-duration": stat(
            "Avg session",
            { calculation: "last", unit: "s", decimals: 1 },
            `SELECT round(avg(seconds), 1) AS avg_seconds
FROM (
  SELECT dateDiff('second', min(Timestamp), max(Timestamp)) AS seconds
  FROM logs
  WHERE ${WITHIN} AND ${OF_SERVICE} AND ${FROM_BROWSER} AND ${attr("session.id")} != ''
  GROUP BY ${attr("session.id")}
)`,
            "First record to last.",
          ),
          "bounce-rate": stat(
            "Bounce rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(40, 70),
            },
            `SELECT round(countIf(views = 1 AND autocaptures = 0 AND seconds < 10) / count() * 100, 1) AS bounce_pct
FROM (
  SELECT ${attr("session.id")} AS session,
         countIf(EventName = 'everr.browser.page_view') AS views,
         countIf(${IS_AUTOCAPTURE}) AS autocaptures,
         maxIf(toFloat64OrZero(${attr("everr.page_view.duration")}), EventName = 'everr.browser.page_leave') / 1000 AS seconds
  FROM logs
  WHERE ${WITHIN} AND ${OF_SERVICE} AND ${FROM_BROWSER} AND ${attr("session.id")} != ''
  GROUP BY session
  HAVING views > 0
)`,
            "One view, no interaction, under 10s.",
          ),
          "visits-over-time": timeSeries(
            "Visitors, sessions and views",
            { showLegend: true },
            `SELECT ts, counted.1 AS series, counted.2 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
         uniqExact(${attr("everr.visitor.id")}) AS visitors,
         uniqExact(${attr("session.id")}) AS sessions,
         count() AS views
  FROM logs
  WHERE ${WITHIN} AND ${OF_SERVICE} AND EventName = 'everr.browser.page_view'
  GROUP BY ts
)
ARRAY JOIN [('Visitors', visitors), ('Sessions', sessions), ('Page views', views)] AS counted
ORDER BY ts`,
          ),
          "views-over-time": timeSeries(
            "Page views by route",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts, ${ROUTE} AS route, count() AS views
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND EventName = 'everr.browser.page_view'
  AND ${topSeries(ROUTE, "logs", `${WITHIN} AND ${OF_SERVICE} AND EventName = 'everr.browser.page_view'`)}
GROUP BY ts, route
ORDER BY ts`,
          ),
          "top-routes": table(
            "Top paths",
            `SELECT route,
       count() AS views,
       uniqExact(visitor) AS visitors,
       round(countIf(autocaptures = 0 AND seconds < 10) / count() * 100, 1) AS bounce_pct,
       round(avgIf(seconds, left), 1) AS avg_seconds,
       round(avgIf(scroll, left) * 100) AS avg_scroll_pct
FROM (
  SELECT ${ROUTE} AS route,
         ${attr("everr.visitor.id")} AS visitor,
         countIf(EventName = 'everr.browser.page_leave') > 0 AS left,
         countIf(${IS_AUTOCAPTURE}) AS autocaptures,
         maxIf(toFloat64OrZero(${attr("everr.page_view.duration")}), EventName = 'everr.browser.page_leave') / 1000 AS seconds,
         maxIf(toFloat64OrZero(${attr("everr.scroll.depth")}), EventName = 'everr.browser.page_leave') AS scroll
  FROM logs
  WHERE ${WITHIN} AND ${OF_SERVICE} AND ${FROM_BROWSER} AND ${attr("everr.page_view.id")} != ''
  GROUP BY ${attr("everr.page_view.id")}, route, visitor
)
GROUP BY route
ORDER BY views DESC
LIMIT 30`,
            "Bounce here is per page view, not per session: a view with no interaction that ended inside 10 seconds. Duration and scroll depth only count views that reported a page_leave.",
          ),
          "top-referrers": table(
            "Top referrers",
            `SELECT multiIf(${attr("everr.referrer.url")} = '', 'direct', domain(${attr("everr.referrer.url")}) = '', 'other', domain(${attr("everr.referrer.url")})) AS referrer,
       uniqExact(${attr("session.id")}) AS sessions,
       uniqExact(${attr("everr.visitor.id")}) AS visitors,
       count() AS views
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND EventName = 'everr.browser.page_view'
  AND ${attr("everr.navigation.type")} = 'initial'
  AND domain(${attr("everr.referrer.url")}) != domain(${attr("url.full")})
GROUP BY referrer
ORDER BY sessions DESC
LIMIT 20`,
            "Hard navigations only, with the site's own pages excluded, so an SPA route change is not counted as a referral from itself.",
          ),
          "top-browsers": table(
            "Popular browsers",
            `SELECT ${BROWSER_NAME} AS browser,
       ${BROWSER_VERSION} AS version,
       uniqExact(${attr("session.id")}) AS sessions,
       uniqExact(${attr("everr.visitor.id")}) AS visitors,
       count() AS views
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND ${FROM_BROWSER} AND EventName = 'everr.browser.page_view'
GROUP BY browser, version
ORDER BY sessions DESC
LIMIT 20`,
            "Read off the resource's user agent. Headless Chrome is broken out on its own, because it is almost never a person.",
          ),
          "top-events": table(
            "Top events",
            `SELECT EventName AS event,
       count() AS occurrences,
       uniqExact(${attr("session.id")}) AS sessions
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND ${FROM_BROWSER} AND EventName != ''
GROUP BY event
ORDER BY occurrences DESC
LIMIT 20`,
          ),
          "rage-targets": table(
            "Rage-click targets",
            `SELECT ${ROUTE} AS route,
       ${attr("everr.element.tag")} AS tag,
       count() AS rage_clicks,
       substring(${attr("everr.element.selector")}, -40) AS selector_tail
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND EventName = 'everr.browser.interaction.rage_click'
GROUP BY route, tag, selector_tail
ORDER BY rage_clicks DESC
LIMIT 30`,
            "Three clicks inside 30px in under a second each. The selector is shown tail-first, because the stable part of a DOM path is its end.",
          ),
        },
        layouts: layout([
          split(
            5,
            "visitors",
            "sessions",
            "page-views",
            "session-duration",
            "bounce-rate",
          ),
          split(8, "visits-over-time", "views-over-time"),
          split(9, "top-routes"),
          split(9, "top-referrers", "top-events"),
          split(9, "top-browsers"),
          split(9, "rage-targets"),
        ]),
      },
    },
  },
];
