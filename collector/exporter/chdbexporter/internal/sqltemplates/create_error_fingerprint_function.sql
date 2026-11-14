-- errorFingerprint UDF for the local collector's chDB. Registered on schema
-- init so `everr local query` and the local browser UI group Errors the same way the
-- cloud does.
--
-- The statement must stay identical to
-- the latest packages/app/clickhouse migration that defines errorFingerprint,
-- or local and cloud fingerprints diverge. packages/app/src/db/clickhouse-migrations.test.ts
-- compares them.
--
-- Callers pass the three attributes as text: `` toString(LogAttributes.`error.fingerprint`) ``
-- and the two exception paths. A query built this way reads three
-- subcolumns of the JSON document and never the whole column. `toString` of
-- a missing path gives '', the same empty value the map form gave.
CREATE OR REPLACE FUNCTION errorFingerprint AS (serviceName, fingerprint, exceptionType, exceptionMessage) ->
  if(
    fingerprint != '',
    fingerprint,
    toString(cityHash64(serviceName, exceptionType, errorMessageTemplate(exceptionMessage), ''))
  )
