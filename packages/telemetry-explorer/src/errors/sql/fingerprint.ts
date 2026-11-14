import { attributeExists, attributeText } from "../../sql/json-attributes";

// Everr's stable identity for an Error. The expression lives in the
// `errorFingerprint` ClickHouse UDF
// (packages/app/clickhouse/0004-create-error-fingerprint-function.sql and the local
// collector's copy), so the web app, local collector, agents, and skills all
// group Errors identically instead of each carrying a copy of the SQL. Callers
// pass ServiceName and the three attributes the UDF reads, each as text, so
// the query reads three subcolumns and never the whole LogAttributes column.
export const ERROR_FINGERPRINT_SQL = `errorFingerprint(ServiceName, ${attributeText("LogAttributes", "error.fingerprint")}, ${attributeText("LogAttributes", "exception.type")}, ${attributeText("LogAttributes", "exception.message")})`;

export const EXCEPTION_LOG_FILTER_SQL = `
  ${attributeExists("ResourceAttributes", "service.name")}
  AND SeverityNumber >= 17
  AND (
    ${attributeExists("LogAttributes", "exception.type")}
    OR ${attributeExists("LogAttributes", "exception.message")}
  )
`;

/**
 * How many distinct Errors a set of log rows holds, as a ClickHouse aggregate.
 *
 * Which rows count as an Error and what makes two of them the same Error are
 * both this module's rules, so callers get the composed aggregate rather than
 * the two halves to combine themselves. Add it to any `SELECT` over `logs`;
 * being a `uniq`, it counts distinct Errors across whatever the query groups
 * by, so a `WITH ROLLUP` total is the range-wide figure and not the sum of the
 * per-group counts.
 */
export function errorIssueCountExpr(): string {
  return `uniqIf(${ERROR_FINGERPRINT_SQL}, ${EXCEPTION_LOG_FILTER_SQL})`;
}

// A ready-to-run query that lists this Error's Occurrences: the same
// exception-log filter and fingerprint expression the app groups Errors by
// (documented in the everr-use-telemetry skill), narrowed to one Fingerprint.
// The Errors page's agent prompt and the issues Everr opens both hand it over.
export function errorOccurrencesQuery(fingerprint: string): string {
  return [
    "SELECT toString(Timestamp) AS timestamp, ServiceName, TraceId,",
    "  toString(LogAttributes.`exception.stacktrace`) AS stacktrace",
    "FROM logs",
    "WHERE Timestamp > now() - INTERVAL 7 DAY",
    `  AND ${EXCEPTION_LOG_FILTER_SQL.trim()}`,
    `  AND (${ERROR_FINGERPRINT_SQL.trim()}) = '${fingerprint}'`,
    "ORDER BY Timestamp DESC",
    "LIMIT 50",
  ].join("\n");
}
