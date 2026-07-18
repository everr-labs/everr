-- errorFingerprint UDF for the local collector's chDB. Registered on schema
-- init so `everr local query` and the desktop app group Errors the same way the
-- cloud does.
--
-- Keep in step with clickhouse/init/04-create-error-fingerprint-function.sql
-- (the body below must stay identical, or local and cloud fingerprints diverge).
CREATE OR REPLACE FUNCTION errorFingerprint AS (serviceName, logAttributes) ->
  if(
    logAttributes['error.fingerprint'] != '',
    logAttributes['error.fingerprint'],
    toString(cityHash64(
      serviceName,
      logAttributes['exception.type'],
      substring(
        replaceRegexpAll(
          replaceRegexpAll(
            replaceRegexpAll(
              trim(BOTH ' ' FROM logAttributes['exception.message']),
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
