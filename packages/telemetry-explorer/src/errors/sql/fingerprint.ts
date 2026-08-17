// Everr's stable identity for an Error. The expression lives in the
// `errorFingerprint` ClickHouse UDF
// (clickhouse/init/04-create-error-fingerprint-function.sql and the local
// collector's copy), so the web app, local collector, agents, and skills all
// group Errors identically instead of each carrying a copy of the SQL. Callers
// pass ServiceName and the whole LogAttributes; the UDF reads
// error.fingerprint / exception.type / exception.message from it.
export const ERROR_FINGERPRINT_SQL = `errorFingerprint(ServiceName, LogAttributes)`;

export const EXCEPTION_LOG_FILTER_SQL = `
  mapContains(ResourceAttributes, 'service.name')
  AND SeverityNumber >= 17
  AND (
    mapContains(LogAttributes, 'exception.type')
    OR mapContains(LogAttributes, 'exception.message')
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
