import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
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

export const browserTemplates: DashboardTemplate[] = [
  {
    id: "web-vitals",
    name: "Web Vitals",
    description:
      "LCP, CLS, INP and TTFB at P75, split by route, with the pages that fail the good/poor thresholds most often.",
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
          lcp: stat(
            "LCP P75",
            {
              calculation: "last",
              unit: "ms",
              decimals: 0,
              thresholds: thresholds(2500, 4000),
            },
            `SELECT round(quantile(0.75)(toFloat64OrZero(${attr("browser.web_vital.value")}))) AS lcp
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
  AND ${attr("browser.web_vital.name")} = 'lcp'`,
          ),
          inp: stat(
            "INP P75",
            {
              calculation: "last",
              unit: "ms",
              decimals: 0,
              thresholds: thresholds(200, 500),
            },
            `SELECT round(quantile(0.75)(toFloat64OrZero(${attr("browser.web_vital.value")}))) AS inp
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
  AND ${attr("browser.web_vital.name")} = 'inp'`,
          ),
          cls: stat(
            "CLS P75",
            {
              calculation: "last",
              decimals: 3,
              thresholds: thresholds(0.1, 0.25),
            },
            `SELECT quantile(0.75)(toFloat64OrZero(${attr("browser.web_vital.value")})) AS cls
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
  AND ${attr("browser.web_vital.name")} = 'cls'`,
          ),
          ttfb: stat(
            "TTFB P75",
            {
              calculation: "last",
              unit: "ms",
              decimals: 0,
              thresholds: thresholds(800, 1800),
            },
            `SELECT round(quantile(0.75)(toFloat64OrZero(${attr("browser.web_vital.value")}))) AS ttfb
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
  AND ${attr("browser.web_vital.name")} = 'ttfb'`,
          ),
          "rating-over-time": timeSeries(
            "Samples by rating",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${attr("everr.browser.web_vital.rating")} AS rating,
       count() AS samples
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
GROUP BY ts, rating
ORDER BY ts`,
          ),
          "by-route": table(
            "P75 by route",
            `SELECT ${ROUTE} AS route,
       ${attr("browser.web_vital.name")} AS vital,
       round(quantile(0.75)(toFloat64OrZero(${attr("browser.web_vital.value")})), 3) AS p75,
       count() AS samples
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
GROUP BY route, vital
HAVING samples >= 5
ORDER BY route, vital
LIMIT 100`,
            "Routes with fewer than 5 samples are hidden: P75 is noise below that.",
          ),
          "poor-pages": table(
            "Pages rated poor",
            `SELECT ${ROUTE} AS route,
       ${attr("browser.web_vital.name")} AS vital,
       countIf(${attr("everr.browser.web_vital.rating")} = 'poor') AS poor,
       count() AS samples,
       round(countIf(${attr("everr.browser.web_vital.rating")} = 'poor') / count() * 100, 1) AS poor_pct
FROM logs
WHERE ${WITHIN} AND EventName = 'browser.web_vital'
GROUP BY route, vital
HAVING poor > 0
ORDER BY poor DESC
LIMIT 50`,
          ),
        },
        layouts: layout([
          split(5, "lcp", "inp", "cls", "ttfb"),
          split(8, "rating-over-time"),
          split(10, "by-route", "poor-pages"),
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

  {
    id: "frontend-errors",
    name: "Frontend Errors",
    description:
      "Browser exceptions grouped the same way backend errors are, with the routes and mechanisms they come from.",
    category: "Browser",
    requires: [needsLogs, needsLogAttribute("everr.page_view.id")],
    document: {
      kind: "Dashboard",
      metadata: { name: "frontend-errors" },
      spec: {
        display: { name: "Frontend Errors" },
        duration: "24h",
        refreshInterval: "5m",
        panels: {
          errors: stat(
            "Errors",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS errors
FROM logs
WHERE ${WITHIN} AND EventName = 'exception'
  AND ${attr("everr.page_view.id")} != ''
GROUP BY ts
ORDER BY ts`,
          ),
          "affected-sessions": stat(
            "Affected sessions",
            { calculation: "last" },
            `SELECT uniqExact(${attr("session.id")}) AS sessions
FROM logs
WHERE ${WITHIN} AND EventName = 'exception'
  AND ${attr("everr.page_view.id")} != ''`,
          ),
          "by-mechanism": timeSeries(
            "Errors by mechanism",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       coalesce(nullIf(${attr("everr.error.mechanism")}, ''), 'manual') AS mechanism,
       count() AS errors
FROM logs
WHERE ${WITHIN} AND EventName = 'exception'
  AND ${attr("everr.page_view.id")} != ''
GROUP BY ts, mechanism
ORDER BY ts`,
          ),
          groups: table(
            "Error groups",
            `SELECT ${attr("exception.type")} AS type,
       replaceRegexpAll(substring(${attr("exception.message")}, 1, 200), '[0-9]+([.][0-9]+)?', 'N') AS message,
       count() AS occurrences,
       uniqExact(${attr("session.id")}) AS sessions,
       any(${ROUTE}) AS sample_route,
       formatDateTime(max(Timestamp), '%Y-%m-%d %H:%i') AS last_seen
FROM logs
WHERE ${WITHIN} AND EventName = 'exception'
  AND ${attr("everr.page_view.id")} != ''
GROUP BY type, message
ORDER BY occurrences DESC
LIMIT 50`,
          ),
          "by-route": table(
            "Error rate by route",
            `SELECT ${ROUTE} AS route,
       countIf(EventName = 'exception') AS errors,
       countIf(EventName = 'everr.browser.page_view') AS views,
       round(countIf(EventName = 'exception') / greatest(countIf(EventName = 'everr.browser.page_view'), 1) * 100, 1) AS errors_per_100_views
FROM logs
WHERE ${WITHIN} AND EventName IN ('exception', 'everr.browser.page_view')
GROUP BY route
HAVING errors > 0
ORDER BY errors DESC
LIMIT 30`,
          ),
        },
        layouts: layout([
          split(5, "errors", "affected-sessions"),
          split(8, "by-mechanism"),
          split(10, "groups"),
          split(9, "by-route"),
        ]),
      },
    },
  },
];
