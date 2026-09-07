-- errorFingerprint: Everr's stable identity for an Error, computed from a log's
-- service name and exception attributes. Centralized as a ClickHouse UDF so the
-- web app, the local collector's chDB, agents, and skills all group Errors
-- identically instead of each carrying a copy of the expression.
--
-- Uses the `error.fingerprint` log attribute when set, else a hash of the
-- service, exception type, and a normalized exception message (UUIDs, long
-- ids/hex, and long quoted literals collapsed so noisy variants group together).
--
-- Callers pass the three attributes as text: `` toString(LogAttributes.`error.fingerprint`) ``
-- and the two exception paths. A query built this way reads three
-- subcolumns of the JSON document and never the whole column. `toString` of
-- a missing path gives '', the same empty value the map form gave.
--
-- Keep in step with the collector's copy at
-- collector/exporter/chdbexporter/internal/sqltemplates/create_error_fingerprint_function.sql
--
-- init/ runs only on a fresh server. Apply to an existing cluster with:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/init/04-create-error-fingerprint-function.sql
CREATE OR REPLACE FUNCTION errorFingerprint AS (serviceName, fingerprint, exceptionType, exceptionMessage) ->
  if(
    fingerprint != '',
    fingerprint,
    toString(cityHash64(
      serviceName,
      exceptionType,
      substring(
        replaceRegexpAll(
          replaceRegexpAll(
            replaceRegexpAll(
              trim(BOTH ' ' FROM exceptionMessage),
              '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
              '<uuid>'
            ),
            '\\b[0-9]{6,}\\b|0x[0-9a-fA-F]+',
            '<id>'
          ),
          '''[^'']{16,}''|"[^"]{16,}"',
          '<quoted>'
        ),
        1,
        300
      ),
      ''
    ))
  )
