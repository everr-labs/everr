# Rate limiting on ingest keys

## What

Enforce per-key rate limits on the public OTLP ingest path so a single noisy or runaway client can't dominate ingest capacity. Configurable per-key in the dashboard.

## Why

The public ingest endpoint accepts OTLP from any client with a valid `ek_` key. Without limits, one misbehaving SDK loop can fill the queue, drive up ClickHouse cost, and impact other tenants. We had a v1 implementation in the collector (per-process fixed-window counter, params returned from the verify endpoint), but dropped it pre-launch to ship the auth path cleanly. Worth re-adding before any non-internal user is sending real volume.

## Who

Anyone running the collector under untrusted ingress. Internal/dev tenants first; external users when they exist.

## Rough appetite

small

## Notes

- Previous design: better-auth `apikey` already has `rateLimitEnabled`, `rateLimitMax`, `rateLimitTimeWindow` columns. Verify endpoint shipped these to the collector; collector enforced them in-process via a fixed-window counter keyed by `keyID`. Tests existed.
- Per-process enforcement means N replicas → N× the configured limit. Fine for a single-collector deployment; needs a shared store (Redis) for fleet enforcement.
- Surface "429" at the OTLP layer cleanly (currently the collector returns generic auth-fail). Requires receiver-side machinery.
- Need a UI in the dashboard to set/edit per-key limits — the create-key dialog currently doesn't expose any rate-limit fields.
- Default at creation should be sane (e.g., 600/min) so unconfigured keys still get a ceiling.
- Add a counter (`everr_apikey.rate_limit_exceeded{key_id=...}`) to collector self-telemetry so we can spot abuse.
- Git history before this todo was filed has the v1 implementation if useful: cache.go had `rateLimit`, `rlState`, `allow()`; verify-key.ts response had a `rateLimit` block.
