# Browser ingest and CORS

A web page using the browser SDK (`@everr/otel-web`) sends OTLP/HTTP straight to the collector with a public key. The browser first sends a CORS preflight, which carries no key, so the listener admits every origin at the CORS layer; the real check is per key, because the collector forwards the request's `Origin` to the verifier, which accepts a public key only from its allowlisted origins.

## Sub-features

- `cors-preflight`: `OPTIONS /v1/<signal>` with `Origin`, `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: authorization,content-type` returns `204` with `access-control-allow-origin: *` and both headers allowed.
- `cors-public-allowed`: a public key from its allowed origin returns `200` and the row lands with the key's tenant.
- `cors-public-foreign`: the same key from another origin returns `401` (see `ingest-auth.md`, `auth-public-foreign-origin`).

## How to get to it (user POV)

- A browser page with `@everr/otel-web` configured with a public key and the collector's ingest URL.
- Any `fetch` from a page to `/v1/logs`, `/v1/traces` or `/v1/metrics`.

## Driving it with verify-collector

Preconditions:

- `$V doctor` prints `COLLECTOR DOCTOR OK`.
- `eval "$($V env)"` in the driving shell, for `$OTLP_HTTP_ORIGIN`.

- **Preflight.** Run `$V http cors-preflight OPTIONS "$OTLP_HTTP_ORIGIN/v1/logs" -H 'Origin: https://allowed.verify.test' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type'`. `--- HTTP 204` with `access-control-allow-origin: *`, `access-control-allow-headers: authorization,content-type`, `access-control-allow-methods: POST`.
- **Allowed origin.** Run `$V otlp cors-public-allowed logs --key public --origin https://allowed.verify.test`. `--- HTTP 200`.
- **Foreign origin.** Run `$V otlp cors-public-foreign logs --key public --origin https://evil.verify.test`. `--- HTTP 401`.
- **Proof.** Run `$V ch-until cors-rows cors-public-allowed "SELECT Body, tenant_id, retention_days FROM app.logs WHERE Body LIKE '%-cors-%'"`. Exactly one row, `cors-public-allowed`, with tenant `verify-<RUN_ID>-a`; then `tail -n 2 "$VERIFY_LOG"` shows `public` with origin `https://allowed.verify.test` and status `200`, and the foreign origin with `403`.

## Gotchas

- This drives the HTTP exchange a browser makes, not a browser. The SDK bundle, its exporter and a real page against a real key are in [verify-web-app](../../verify-web-app/SKILL.md) (`features/web-browser-sdk.md`).
- `access-control-allow-origin` is `*` for every origin by design. Do not read the preflight as the origin check; the `401` for the foreign origin is.
- The allowlist lives in the stub's `keys.json` (`https://allowed.verify.test`). Origins are compared after URL normalization, as the application does (`https://allowed.verify.test/` matches).
