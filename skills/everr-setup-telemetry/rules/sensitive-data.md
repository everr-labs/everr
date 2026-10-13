# Sensitive Data

Telemetry is copied, indexed, retained, and queried. Prevent sensitive data from entering spans, metrics, logs, resource attributes, and status messages at the source.

## Never Instrument

Never attach these values to any telemetry signal:

| Category | Examples |
| --- | --- |
| Credentials | passwords, API keys, bearer tokens, OAuth secrets |
| Session material | cookies, `Set-Cookie`, session ids |
| Financial instruments | card numbers, bank accounts, CVVs |
| Government identifiers | SSNs, tax ids, passport numbers |
| Health records | diagnoses, prescriptions, medical record numbers |
| Biometric data | fingerprints, face geometry, retinal scans |
| Raw auth headers | `Authorization`, `Cookie`, `Set-Cookie` values |
| Raw payloads | request bodies, response bodies, form data, uploaded files |

If the user asks to correlate using sensitive values, use a keyed hash or partially masked representation.

## High-Risk Fields

Evaluate before including:

- `user.id`: only opaque internal ids, never email or username.
- `enduser.id`: same rule as `user.id`.
- IP address: include only when needed; truncate or hash when full precision is unnecessary.
- `url.full`: strip or redact query parameters.
- `db.query.text`: never include literal parameter values.
- Error messages: ensure they do not echo user input.

High-risk values must never be metric attributes.

## URL Sanitization

Strip query parameters unless there is a strong reason to keep safe ones.

```javascript
function sanitizeUrl(value) {
  const url = new URL(value);
  url.search = '';
  return url.toString();
}
```

When preserving selected query params, explicitly redact sensitive keys such as `token`, `api_key`, `session`, `code`, `email`, and `password`.

## Database Query Sanitization

Prefer parameterized query text without literal values.

Good:

```text
SELECT * FROM users WHERE email = $1
```

Bad:

```text
SELECT * FROM users WHERE email = 'alice@example.com'
```

If auto-instrumentation captures unsafe queries:

1. Use instrumentation library options to disable or sanitize query capture.
2. If unavailable, use a span processor to sanitize `db.query.text` before export.
3. Use collector-side redaction as a defense-in-depth layer.
4. Disable query capture if no safe option exists.

## Structured Logging Safeguards

Pick fields explicitly:

```javascript
logger.info('request.received', {
  method: req.method,
  route: req.route?.path,
  content_length: req.headers['content-length'],
});
```

Do not log `req.headers`, `req.body`, `res.body`, form data, or user objects wholesale.

## Hashing For Correlation

Use keyed HMAC when a sensitive value needs stable correlation.

```javascript
import { createHmac } from 'node:crypto';

function hashForTelemetry(value, key) {
  return createHmac('sha256', key).update(value).digest('hex');
}
```

Store the key and any mapping outside telemetry in an access-controlled system.

## Redacting Auto-Instrumented Telemetry

Auto-instrumented spans may contain attributes the call site does not control. Prefer built-in allow/deny list configuration. If needed, register a processor before the exporter to redact attributes such as:

- `http.request.header.authorization`
- `http.request.header.cookie`
- `http.response.header.set-cookie`
- `url.full` query params
- unsafe `db.query.text`

Collector-side redaction is useful as a safety net, but it is not a substitute for source-level sanitization because the data has already left the process.

## Tests

Add tests for paths that handle user data:

- Sensitive headers are absent or `REDACTED`.
- `user.id` is opaque and not an email or display name.
- URLs do not contain sensitive query params.
- Logs do not include request bodies or auth headers.
- Metric attributes do not include unbounded identifiers.
