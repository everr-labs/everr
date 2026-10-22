# Telemetry origins are distinct from query surfaces

Everr models **three origins** of telemetry — Local, CI, and Production — but exposes only **two query surfaces**: the local Collector and the Cloud backend. CI and Production telemetry both land in the Cloud; Local telemetry stays in the Collector. We keep these as two separate axes rather than collapsing them into one list of "environments" because where telemetry _comes from_ (an origin, a product concept users reason about) is not the same as where it is _stored and queried_ (a surface, an operational fact). Conflating them is what makes the CLI's `everr local query` / `everr cloud query` look like it's "missing" CI and Production — it isn't; CI and Production are origins served by the Cloud surface.

## Consequences

- The CLI deliberately has no `everr ci query` or `everr production query`. Querying CI or Production telemetry goes through `everr cloud query`, filtered by origin. This is intentional, not an omission to "fix."
- "Cloud" and "Production" are not synonyms and must not be used interchangeably (see [CONTEXT.md](../../CONTEXT.md)). Cloud is a surface; Production is an origin.
- New telemetry sources are classified first by origin (where it runs), then routed to a surface (Collector or Cloud). Adding an origin does not imply adding a surface.
