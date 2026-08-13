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
      "Sessions, page views and the routes people actually land on, plus rage clicks as a standing signal of broken UI.",
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
          sessions: stat(
            "Sessions",
            { calculation: "last" },
            `SELECT uniqExact(${attr("session.id")}) AS sessions
FROM logs
WHERE ${WITHIN} AND EventName = 'everr.browser.page_view'`,
          ),
          "page-views": stat(
            "Page views",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS views
FROM logs
WHERE ${WITHIN} AND EventName = 'everr.browser.page_view'
GROUP BY ts
ORDER BY ts`,
          ),
          "rage-clicks": stat(
            "Rage clicks",
            {
              calculation: "sum",
              sparkline: true,
              thresholds: thresholds(1, 25),
            },
            `SELECT ${BUCKET()} AS ts, count() AS rage_clicks
FROM logs
WHERE ${WITHIN} AND EventName = 'everr.browser.interaction.rage_click'
GROUP BY ts
ORDER BY ts`,
            "Three clicks inside 30px in under a second each.",
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
            "Top routes",
            `SELECT ${ROUTE} AS route,
       count() AS views,
       uniqExact(${attr("session.id")}) AS sessions,
       round(avgIf(toFloat64OrZero(${attr("everr.page_view.duration")}), EventName = 'everr.browser.page_leave') / 1000, 1) AS avg_seconds
FROM logs
WHERE ${WITHIN}
  AND EventName IN ('everr.browser.page_view', 'everr.browser.page_leave')
GROUP BY route
ORDER BY views DESC
LIMIT 30`,
          ),
          "rage-targets": table(
            "Rage-click targets",
            `SELECT ${ROUTE} AS route,
       ${attr("everr.element.selector")} AS selector,
       count() AS rage_clicks
FROM logs
WHERE ${WITHIN} AND EventName = 'everr.browser.interaction.rage_click'
GROUP BY route, selector
ORDER BY rage_clicks DESC
LIMIT 30`,
          ),
        },
        layouts: layout([
          split(5, "sessions", "page-views", "rage-clicks"),
          split(8, "views-over-time"),
          split(9, "top-routes", "rage-targets"),
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
