import { attributeExists, attributeText } from "../../sql/json-attributes";

// Everr's stable identity for an Error. The expression lives in the
// `errorFingerprint` ClickHouse UDF
// (clickhouse/init/04-create-error-fingerprint-function.sql and the local
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
