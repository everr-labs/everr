const NORMALIZED_EXCEPTION_MESSAGE_SQL = `
  substring(
    replaceRegexpAll(
      replaceRegexpAll(
        replaceRegexpAll(
          trim(BOTH ' ' FROM LogAttributes['exception.message']),
          '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
          '<uuid>'
        ),
        '\\\\b[0-9]{6,}\\\\b|0x[0-9a-fA-F]+',
        '<id>'
      ),
      '''[^'']{16,}''|"[^"]{16,}"',
      '<quoted>'
    ),
    1,
    300
  )
`;

const STATIC_ERROR_FINGERPRINT_SQL = "LogAttributes['error.fingerprint']";

const FALLBACK_ERROR_FINGERPRINT_SQL = `
  toString(cityHash64(
      ServiceName,
      LogAttributes['exception.type'],
      ${NORMALIZED_EXCEPTION_MESSAGE_SQL},
      ''
    ))
`;

export const ERROR_FINGERPRINT_SQL = `
  if(
    ${STATIC_ERROR_FINGERPRINT_SQL} != '',
    ${STATIC_ERROR_FINGERPRINT_SQL},
    ${FALLBACK_ERROR_FINGERPRINT_SQL}
  )
`;

export const ERROR_FINGERPRINT_FILTER_SQL = `
  (
    ${STATIC_ERROR_FINGERPRINT_SQL} = {fingerprint:String}
    OR (
      (
        NOT mapContains(LogAttributes, 'error.fingerprint')
        OR ${STATIC_ERROR_FINGERPRINT_SQL} = ''
      )
      AND ${FALLBACK_ERROR_FINGERPRINT_SQL} = {fingerprint:String}
    )
  )
`;

export const EXCEPTION_LOG_FILTER_SQL = `
  mapContains(ResourceAttributes, 'service.name')
  AND SeverityNumber >= 17
  AND (
    LogAttributes['exception.type'] != ''
    OR LogAttributes['exception.message'] != ''
  )
`;
