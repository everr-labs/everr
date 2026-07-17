if(
  LogAttributes['error.fingerprint'] != '',
  LogAttributes['error.fingerprint'],
  toString(cityHash64(
    ServiceName,
    LogAttributes['exception.type'],
    substring(
      replaceRegexpAll(
        replaceRegexpAll(
          replaceRegexpAll(
            trim(BOTH ' ' FROM LogAttributes['exception.message']),
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
