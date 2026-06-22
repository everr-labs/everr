---
"@everr/desktop-app": patch
---

Separate the capabilities of `ek_` API keys into two scopes: `ingest` (send
OpenTelemetry data) and `apply` (run `everr apply` against dashboards,
notebooks, and alerts). The collector's verify endpoint and the apply
endpoint each check the matching scope; a key minted for one capability
is now refused when used for the other.

- New keys are minted with both scopes checked by default, but the
  **New API key** dialog now exposes a Capabilities section so you can
  mint a key with just one scope (for example, an `ingest`-only key for a
  public collector, or an `apply`-only deploy key for CI).
- Keys minted before this change keep working — a key with no scope map
  is treated as fully scoped.
- The Ingest Keys page is now called **API keys** (the old `/ingest-keys`
  URL redirects), and its table gains a per-row Capabilities column so you
  can see what each key is authorized for.
- The CLI now reads `EVERR_API_KEY` for the apply command (preferred).
  `EVERR_API_TOKEN` is still accepted as a deprecated alias so existing
  CI setups keep working.
