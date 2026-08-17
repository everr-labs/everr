import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { BuiltinDashboard } from "../types";
import {
  BUCKET,
  needsLogs,
  OF_SERVICE,
  SERIES_BUCKET,
  serviceVariable,
  WITHIN,
} from "./shared";

const IS_ERROR = "upper(SeverityText) IN ('ERROR', 'FATAL')";

export const logBuiltins: BuiltinDashboard[] = [
  {
    id: "log-overview",
    name: "Log Overview",
    description:
      "Log volume by severity and service, the error share of it, and the messages that repeat most.",
    category: "Application",
    requires: [needsLogs],
    document: {
      kind: "Dashboard",
      metadata: { name: "log-overview" },
      spec: {
        display: { name: "Log Overview" },
        duration: "6h",
        refreshInterval: "1m",
        variables: [serviceVariable("logs")],
        panels: {
          volume: stat(
            "Log records",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS records
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE}
GROUP BY ts
ORDER BY ts`,
          ),
          "error-share": stat(
            "Error share",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(1, 5),
            },
            `SELECT countIf(${IS_ERROR}) / count() * 100 AS error_pct
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE}`,
          ),
          "error-logs": stat(
            "Error records",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS errors
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND ${IS_ERROR}
GROUP BY ts
ORDER BY ts`,
          ),
          "by-severity": timeSeries(
            "Records by severity",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       upper(SeverityText) AS severity,
       count() AS records
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND SeverityText != ''
GROUP BY ts, severity
ORDER BY ts`,
          ),
          "noisiest-messages": table(
            "Repeated messages",
            `SELECT ServiceName AS service,
       replaceRegexpAll(substring(Body, 1, 160), '[0-9]+([.][0-9]+)?', 'N') AS message,
       upper(any(SeverityText)) AS severity,
       count() AS occurrences
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE}
GROUP BY service, message
ORDER BY occurrences DESC
LIMIT 40`,
            "Numbers are normalized away, so one message with varying ids groups as one row.",
          ),
          "recent-errors": table(
            "Recent errors",
            `SELECT formatDateTime(Timestamp, '%m-%d %H:%i:%S') AS time,
       ServiceName AS service,
       substring(Body, 1, 140) AS message,
       TraceId AS trace_id
FROM logs
WHERE ${WITHIN} AND ${OF_SERVICE} AND ${IS_ERROR}
ORDER BY Timestamp DESC
LIMIT 50`,
          ),
        },
        layouts: layout([
          split(5, "volume", "error-share", "error-logs"),
          split(8, "by-severity"),
          split(9, "noisiest-messages", "recent-errors"),
        ]),
      },
    },
  },
];
