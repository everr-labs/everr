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
    LogAttributes['exception.type'] != ''
    OR LogAttributes['exception.message'] != ''
  )
`;
