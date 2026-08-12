# Full-Stack Vite SSR Instrumentation

Use this rule for full-stack apps built on Vite with server-side rendering on Node.js: a custom SSR server (Express, Hono, plain `node server.js`), a Nitro-based output, or a framework CLI that runs Vite in the middle. For TanStack Start specifics, read `tanstack-start.md` on top of this rule. For Next.js, use `nextjs.md` instead.

Node.js servers only. Edge and worker runtimes (Cloudflare Workers, Deno Deploy) are out of scope: the OpenTelemetry Node SDK does not run there.

## Two Halves, Two Rules

A full-stack Vite app is two services that happen to share a repo:

- **Browser half**: `@everr/otel-web` per `browser.md`. One side-effect module imported before the app renders. Public origin-bound key in production, local collector in dev.
- **Server half**: `@opentelemetry/sdk-node` per `nodejs.md`. A setup module loaded before framework, HTTP, and database imports.

This rule owns only what neither half covers alone: wiring both into one Vite project and joining their traces.

## Server Setup Placement

- Put the NodeSDK setup in its own module (`src/telemetry/node.ts` or similar) and import it first in the server entry, before the framework or any I/O library.
- `vite dev` runs the SSR server inside the Vite process and re-evaluates modules on reload. Guard the setup with an idempotent global (`globalThis` key or `Symbol.for`) so hot reload cannot start a second SDK.
- The production build runs the same module from the built server entry (`.output/server/index.mjs` for Nitro). Confirm the setup module survives the build by checking the built entry imports it, not by assuming.
- Keep the setup module out of any code path the client bundle imports. Vite will happily bundle Node-only packages into the browser and fail late; the browser half imports only `@everr/otel-web`.

## Environment Split

Vite exposes `import.meta.env.VITE_*` to the client and `process.env` to the server. Keep the two surfaces separate:

| Variable | Side | Purpose |
| --- | --- | --- |
| `VITE_EVERR_PUBLIC_INGEST_KEY` | client | Public origin-bound key, production browser export |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | server | Optional local/custom collector override |
| `EVERR_INGEST_KEY` | server | Secret key, production server export |

Never move `EVERR_INGEST_KEY` into a `VITE_`-prefixed variable: the `VITE_` prefix is exactly the boundary that ships values to every visitor.

## The Seam: Joining Browser And Server Traces

- Give each half its own `service.name` (for example `shop-web` and `shop-server`) so the sides stay separable in queries. Never share one name.
- `@everr/otel-web`'s `network()` instrumentation injects `traceparent` on same-origin requests by default, so browser-initiated requests parent the server spans with no extra configuration. Cross-origin APIs need the target listed in `network()` options and `traceparent` in the server's CORS `Access-Control-Allow-Headers`.
- On the server, the HTTP auto-instrumentation extracts incoming W3C context automatically. If incoming-request instrumentation is disabled in favor of a manual SERVER span, extract explicitly with `propagation.extract(context.active(), request.headers, getter)` and pass the result as the span's parent context.
- Align route templates across the seam: register a `request` resolver with `setRouteResolver({ request })` that produces the same value the server stamps on `http.route`, so a request's `url.template` matches its server span's route. Share one module between both halves, and build it only from exact sources: the framework's matched route where the server exposes it, an `x-everr-route` response header echoed by the server (`network()` reads it into `url.template`, and it wins over the resolver; a cross-origin server must list it in `Access-Control-Expose-Headers`), or an explicit table of the app's parameterized endpoints. A template the resolver cannot derive exactly should be `undefined` (the span name falls back to the path, and `url.full` still carries the truth). Never infer a template from the shape of a segment (digits, hex, UUID lookalikes): a heuristic that guesses differently on the two halves silently breaks the join, and one that guesses wrong pollutes `url.template` with fake routes.

## CORS In Development

The browser posts OTLP to the collector from the page's origin. The local CLI collector accepts any origin, but if dev telemetry routes through another collector, its CORS allowlist must include the exact dev origin, port included. A disallowed origin fails preflight and the SDK drops batches silently: when browser rows are missing but server rows arrive, check the collector's CORS allowlist against the page origin before touching the app code.

## Validation

Validate the seam, not just each half:

1. Load the app in a real browser and trigger a page that fetches from the server.
2. `everr local query` for fresh rows under the browser `ServiceName` and separately under the server `ServiceName`.
3. Prove the join: at least one `TraceId` with spans from both service names.

```sql
SELECT TraceId, groupUniqArray(ServiceName) AS services
FROM traces
WHERE Timestamp > now() - INTERVAL 5 MINUTE
GROUP BY TraceId
HAVING has(services, '<browser-service-name>')
  AND has(services, '<server-service-name>')
LIMIT 5
```

No joined rows with both halves emitting usually means `network()` is missing, the request was cross-origin without a configured target, or the server span ignored the incoming `traceparent`.
