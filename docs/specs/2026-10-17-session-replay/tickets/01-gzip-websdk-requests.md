# 01: Gzip WebSDK requests

**What to build:** Every WebSDK request that is not part of the exit flush is gzipped with `CompressionStream` and sent with `Content-Encoding: gzip`. When `CompressionStream` is missing or compression fails, the request goes as plain JSON. Exit-flush requests stay plain JSON. A host `send` keeps getting the plain JSON string. Browser ingest keeps working cross-origin because the collector CORS allow-lists accept `Content-Encoding`.

**Blocked by:** None (can start immediately)

**Complexity:** medium

**Verify:** `pnpm --filter @everr/otel-web test && pnpm --filter @everr/otel-web typecheck && pnpm --filter @everr/otel-web size && (cd collector && make test-all)`

**Status:** ready-for-agent

- [ ] Normal sends are gzipped with `Content-Encoding: gzip`; tests decode the body and get the same OTLP payload as before
- [ ] Fallback to plain JSON when `CompressionStream` is absent or throws
- [ ] Exit flush requests are plain JSON and stay within the existing keepalive budget
- [ ] Host `send` receives a plain JSON string, unchanged
- [ ] `allowed_headers` in the example collector config and the local gateway CORS block allow `Content-Encoding`
- [ ] A preflight with `Access-Control-Request-Headers: content-encoding` against the local gateway is allowed (behaviour test, not a YAML text test)
- [ ] `pnpm size` run; main entry budget raised only by this change
