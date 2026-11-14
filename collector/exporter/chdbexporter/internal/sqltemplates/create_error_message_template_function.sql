-- errorMessageTemplate UDF for the local collector's chDB: an exception
-- message with its variable parts replaced by placeholders. errorFingerprint
-- calls it, so it is registered first.
--
-- The statement must stay identical to the latest packages/app/clickhouse
-- migration that defines errorMessageTemplate.
-- packages/app/src/db/clickhouse-migrations.test.ts compares them.
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
