-- Groups more of an Error's variants together. errorMessageTemplate turns an
-- exception message into its template: URLs, emails, UUIDs, long quoted
-- literals, IP addresses, hex ids, durations, and numbers are replaced with a
-- placeholder. Three-digit numbers stay, since they are usually HTTP status
-- codes, and a 404 and a 500 are different Errors. errorFingerprint hashes the
-- template, so "User 4821 not found" and "User 77 not found" are one Error.
--
-- The fingerprint does not use stack frames: frame names in minified bundles
-- change with every build, and the fingerprint must stay the same across
-- deploys and between the local collector and the cloud.
--
-- Both functions run at query time and no table stores their output, so the
-- change regroups past logs too. The local collector's chDB registers the same
-- two statements from collector/exporter/chdbexporter/internal/sqltemplates;
-- clickhouse-migrations.test.ts fails while they differ.
CREATE OR REPLACE FUNCTION errorMessageTemplate AS (exceptionMessage) ->
  substring(
    replaceRegexpAll(
      replaceRegexpAll(
        replaceRegexpAll(
          replaceRegexpAll(
            replaceRegexpAll(
              replaceRegexpAll(
                replaceRegexpAll(
                  replaceRegexpAll(
                    trim(BOTH ' ' FROM exceptionMessage),
                    '[A-Za-z][A-Za-z0-9+.-]*://[^\\s''"<>]+',
                    '<url>'
                  ),
                  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
                  '<email>'
                ),
                '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
                '<uuid>'
              ),
              '''[^'']{16,}''|"[^"]{16,}"',
              '<quoted>'
            ),
            '\\b[0-9]{1,3}(\\.[0-9]{1,3}){3}(:[0-9]{1,5})?\\b',
            '<ip>'
          ),
          '0x[0-9a-fA-F]+|\\b[0-9a-fA-F]{16,}\\b',
          '<id>'
        ),
        '\\b[0-9]+(\\.[0-9]+)?\\s?(ns|us|µs|ms|s|sec|secs|seconds|m|min|mins|minutes|h|hours)\\b',
        '<duration>'
      ),
      '\\b[0-9]+\\.[0-9]+\\b|\\b[0-9]{1,2}\\b|\\b[0-9]{4,}\\b',
      '<n>'
    ),
    1,
    300
  )
;

CREATE OR REPLACE FUNCTION errorFingerprint AS (serviceName, fingerprint, exceptionType, exceptionMessage) ->
  if(
    fingerprint != '',
    fingerprint,
    toString(cityHash64(serviceName, exceptionType, errorMessageTemplate(exceptionMessage), ''))
  )
;
