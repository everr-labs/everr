import {
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
  SERIES_BUCKET,
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

/** P75 of one vital over the whole window — the statistic the bands are defined on. */
const vitalP75 = (vital: string, decimals: number) =>
  `SELECT round(quantile(0.75)(${VITAL_VALUE}), ${decimals}) AS p75
FROM logs
WHERE ${WITHIN} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = '${vital}'`;

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
  const pairs = phases
    .map(([label], index) => `('${label}', ${alias(index)})`)
    .join(", ");
  return `SELECT ts, phase.1 AS series, phase.2 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
${columns}
  FROM logs
  WHERE ${WITHIN} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
    AND ${VITAL_NAME} = '${vital}'
  GROUP BY ts
)
ARRAY JOIN [${pairs}] AS phase
ORDER BY ts`;
};

export const browserBuiltins: BuiltinDashboard[] = [
  {
    id: "web-vitals",
    name: "Web Vitals",
    description:
      "The four Core Web Vitals at P75 against their published good/poor bands, the page loads and errors behind them, what each slow vital was waiting on, and the routes and elements responsible.",
    category: "Browser",
    requires: [needsLogs, needsLogAttribute("browser.web_vital")],
    document: {
      kind: "Dashboard",
      metadata: { name: "web-vitals" },
      spec: {
        display: { name: "Web Vitals" },
        duration: "24h",
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
            },
            vitalP75("lcp", 0),
            "Largest Contentful Paint.",
          ),
          inp: gauge(
            "INP P75",
            {
              unit: "ms",
              decimals: 0,
              min: 0,
              max: 700,
              thresholds: vitalBands(200, 500),
            },
            vitalP75("inp", 0),
            "Interaction to Next Paint.",
          ),
          cls: gauge(
            "CLS P75",
            {
              decimals: 3,
              min: 0,
              max: 0.35,
              thresholds: vitalBands(0.1, 0.25),
            },
            vitalP75("cls", 3),
            "Cumulative Layout Shift, unitless.",
          ),
          ttfb: gauge(
            "TTFB P75",
            {
              unit: "ms",
              decimals: 0,
              min: 0,
              max: 2400,
              thresholds: vitalBands(800, 1800),
            },
            vitalP75("ttfb", 0),
            "Time to First Byte.",
          ),
          "page-loads": stat(
            "Page loads",
            { calculation: "last" },
            `SELECT count() AS loads
FROM logs
WHERE ${WITHIN} AND ${FROM_BROWSER} AND EventName = 'everr.browser.page_view'`,
            "SPA route changes included.",
          ),
          "js-errors": stat(
            "JS errors",
            { calculation: "last" },
            `SELECT count() AS errors
FROM logs
WHERE ${WITHIN} AND ${FROM_BROWSER} AND EventName = 'exception'`,
            "Every mechanism, including React boundaries.",
          ),
          "error-rate": stat(
            "Errors per 100 loads",
            { calculation: "last", decimals: 1, thresholds: thresholds(5, 20) },
            `SELECT round(countIf(EventName = 'exception') / greatest(countIf(EventName = 'everr.browser.page_view'), 1) * 100, 1) AS per_hundred
FROM logs
WHERE ${WITHIN} AND ${FROM_BROWSER}`,
            "Can exceed 100: one load may throw repeatedly.",
          ),
          "loads-and-errors": timeSeries(
            "Page loads and errors",
            { showLegend: true },
            `SELECT ts, counted.1 AS series, counted.2 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
         countIf(EventName = 'everr.browser.page_view') AS loads,
         countIf(EventName = 'exception') AS errors
  FROM logs
  WHERE ${WITHIN} AND ${FROM_BROWSER}
  GROUP BY ts
)
ARRAY JOIN [('Page loads', loads), ('JS errors', errors)] AS counted
ORDER BY ts`,
            "On one axis on purpose: the question is whether errors track traffic or spike against it.",
          ),
          "rating-over-time": timeSeries(
            "Samples by rating",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts, ${RATING} AS rating, count() AS samples
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
GROUP BY ts, rating
ORDER BY ts`,
            "All four vitals together, as the SDK rated each sample.",
          ),
          "ms-over-time": timeSeries(
            "LCP, INP and TTFB P75 over time",
            { showLegend: true, unit: "ms" },
            `SELECT ts, vital.1 AS series, vital.2 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
         round(quantileIf(0.75)(${VITAL_VALUE}, ${VITAL_NAME} = 'lcp')) AS lcp,
         round(quantileIf(0.75)(${VITAL_VALUE}, ${VITAL_NAME} = 'inp')) AS inp,
         round(quantileIf(0.75)(${VITAL_VALUE}, ${VITAL_NAME} = 'ttfb')) AS ttfb
  FROM logs
  WHERE ${WITHIN} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
  GROUP BY ts
)
ARRAY JOIN [('LCP', lcp), ('INP', inp), ('TTFB', ttfb)] AS vital
ORDER BY ts`,
            "Samples over a minute are dropped here and on every panel that averages a value: a suspended tab keeps the timer running.",
          ),
          "cls-over-time": timeSeries(
            "CLS P75 over time",
            {},
            `SELECT ${BUCKET()} AS ts, round(quantile(0.75)(${VITAL_VALUE}), 3) AS cls
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = 'cls'
GROUP BY ts
ORDER BY ts`,
            "Its own panel: CLS is unitless and would be a flat zero beside three millisecond series.",
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
          "by-route": table(
            "P75 by route",
            `SELECT ${ROUTE} AS route,
       ${VITAL_NAME} AS vital,
       round(quantile(0.75)(${VITAL_VALUE}), 3) AS p75,
       count() AS samples
FROM logs
WHERE ${WITHIN} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
GROUP BY route, vital
HAVING samples >= 5
ORDER BY route, vital
LIMIT 100`,
            "Routes with fewer than 5 samples are hidden: P75 is noise below that.",
          ),
          "poor-pages": table(
            "Pages rated poor",
            `SELECT ${ROUTE} AS route,
       ${VITAL_NAME} AS vital,
       countIf(${RATING} = 'poor') AS poor,
       count() AS samples,
       round(countIf(${RATING} = 'poor') / count() * 100, 1) AS poor_pct
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
GROUP BY route, vital
HAVING poor > 0
ORDER BY poor DESC
LIMIT 50`,
          ),
          "lcp-elements": table(
            "Slowest LCP elements",
            `SELECT ${attr("everr.browser.web_vital.lcp.target")} AS element,
       round(quantile(0.75)(${VITAL_VALUE})) AS lcp_p75_ms,
       count() AS samples
FROM logs
WHERE ${WITHIN} AND ${SANE_VITAL} AND EventName = 'browser.web_vital'
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
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
  AND ${VITAL_NAME} = 'cls'
  AND ${attr("everr.browser.web_vital.cls.largest_shift_target")} != ''
GROUP BY element, load_state
ORDER BY shift_p75 DESC
LIMIT 25`,
            "The single largest shift of each sample, and how far the page had loaded when it moved.",
          ),
        },
        layouts: layout([
          split(6, "lcp", "inp", "cls", "ttfb"),
          split(4, "page-loads", "js-errors", "error-rate"),
          split(9, "loads-and-errors", "rating-over-time"),
          split(9, "ms-over-time", "cls-over-time"),
          split(9, "lcp-phases", "ttfb-phases"),
          split(10, "by-route", "poor-pages"),
          split(9, "lcp-elements", "cls-elements"),
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
        refreshInterval: "5m",
        panels: {
          visitors: stat(
            "Visitors",
            { calculation: "last" },
            `SELECT uniqExact(${attr("everr.visitor.id")}) AS visitors
FROM logs
WHERE ${WITHIN} AND ${FROM_BROWSER} AND EventName = 'everr.browser.page_view'`,
            "Distinct visitor ids.",
          ),
          sessions: stat(
            "Sessions",
            { calculation: "last" },
            `SELECT uniqExact(${attr("session.id")}) AS sessions
FROM logs
WHERE ${WITHIN} AND ${FROM_BROWSER} AND EventName = 'everr.browser.page_view'`,
            "30-minute idle timeout.",
          ),
          "page-views": stat(
            "Page views",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS views
FROM logs
WHERE ${WITHIN} AND EventName = 'everr.browser.page_view'
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
  WHERE ${WITHIN} AND ${FROM_BROWSER} AND ${attr("session.id")} != ''
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
  WHERE ${WITHIN} AND ${FROM_BROWSER} AND ${attr("session.id")} != ''
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
  WHERE ${WITHIN} AND EventName = 'everr.browser.page_view'
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
WHERE ${WITHIN} AND EventName = 'everr.browser.page_view'
  AND ${topSeries(ROUTE, "logs", `${WITHIN} AND EventName = 'everr.browser.page_view'`)}
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
  WHERE ${WITHIN} AND ${FROM_BROWSER} AND ${attr("everr.page_view.id")} != ''
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
WHERE ${WITHIN} AND EventName = 'everr.browser.page_view'
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
WHERE ${WITHIN} AND ${FROM_BROWSER} AND EventName = 'everr.browser.page_view'
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
WHERE ${WITHIN} AND ${FROM_BROWSER} AND EventName != ''
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
WHERE ${WITHIN} AND EventName = 'everr.browser.interaction.rage_click'
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
