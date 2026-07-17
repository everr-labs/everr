mapContains(ResourceAttributes, 'service.name')
AND SeverityNumber >= 17
AND (
  LogAttributes['exception.type'] != ''
  OR LogAttributes['exception.message'] != ''
)
