# Jaeger UI integration research

Investigated 2026-10-06. This is research, not an accepted architecture decision. Official documentation currently labels 2.21 as latest; source links below target upstream main and should be rechecked against the exact release selected for implementation.

## Confirmed upstream facts

- Jaeger UI is a private application package, not a published drop-in trace viewer library. Its package uses Vite and depends on React 19, React Router, Redux, Zustand, Ant Design, and the workspace Plexus graph package. [Package manifest](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/package.json)
- `TraceTimelineViewerImpl` is exported internally and accepts an enriched `IOtelTrace`, but still reads shared Zustand stores, config, global keyboard shortcuts, window layout, and application CSS. The default export is Redux-connected. Native reuse means extracting and maintaining a component boundary, not simply installing a package. [Timeline source](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/components/TracePage/TraceTimelineViewer/index.tsx)
- Official embedded mode supports `/trace/{trace-id}?uiEmbed=v0`, plus search embedding and flags to hide the minimap, summary, or collapse the header. Configuration also supports link patterns and restricting upload/JSON/new-window controls. [UI configuration](https://www.jaegertracing.io/docs/2.21/deployment/frontend-ui/)
- Jaeger's own Grafana integration decision chooses iframe rendering over component extraction. It documents Redux, singleton state, router, Ant Design, and stylesheet coupling, plus theme and external-link tradeoffs. Its extraction estimate is 4 to 8 weeks for that Grafana project, not an Everr estimate. [Upstream integration ADR](https://github.com/jaegertracing/grafana-plugin/blob/main/docs/adr/0001-jaeger-ui-in-grafana.md)
- Current single-trace loading calls `JaegerAPI.fetchTrace(id)` and transforms `response.data[0]`. The transport uses prefixed `/api/traces/{id}` and `credentials: 'same-origin'`. [Loading hook](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/hooks/useTraceLoading.ts), [API transport](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/api/jaeger.ts)
- Legacy trace JSON has `traceID`, `spans`, and a `processes` map. Spans carry `spanID`, `traceID`, `processID`, `operationName`, numeric microsecond `startTime`/`duration`, tags, logs, and references. The UI derives hierarchy and timing, then exposes an OTel facade. [Wire types](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/types/trace.ts), [Transformation](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/model/transform-trace-data.ts)
- The UI's legacy HTTP JSON API is explicitly internal and subject to change. Stable OTLP-based v3 read APIs exist, and UI migration to them is in progress. A compatibility adapter must match the pinned UI build's actual requests. [API guarantees](https://www.jaegertracing.io/docs/2.21/architecture/apis/), [OTel migration RFC](https://github.com/jaegertracing/jaeger-ui/blob/main/docs/rfc/0002-otel-native-jaeger-ui.md)
- Production build output is static files in `packages/jaeger-ui/build`. Recent UI releases detect their mount prefix, while the server must provide SPA fallback for bookmarked trace routes. Serving the UI does not itself require running a Jaeger collector or replacing Everr storage. [Build instructions](https://github.com/jaegertracing/jaeger-ui/blob/main/CONTRIBUTING.md), [Base-path ADR](https://github.com/jaegertracing/jaeger/blob/main/docs/adr/009-ui-base-path-auto-detection.md)
- The upstream license is Apache 2.0. Redistribution work includes preserving the license and applicable notices and marking modified files. [License](https://github.com/jaegertracing/jaeger-ui/blob/main/LICENSE)

## Everr integration judgment

Start with the trace detail viewer, keeping Everr search, routing, and storage. Bundle a pinned Jaeger UI build separately and embed its trace route. For the web app, serve it beneath the existing origin with a narrow compatibility API that applies existing session and organization authorization. This keeps dependencies and CSS isolated while retaining the established trace list.

The adapter maps Everr spans into the selected wire format: nanoseconds to microseconds, parent IDs to `CHILD_OF`, resources to processes, attributes to tags, events to logs, and status/kind/link semantics to the corresponding Jaeger representation. Audit link and event fidelity rather than treating links as parents. Current Everr attributes are flattened strings, so typed attributes need a deliberate choice: preserve strings initially or improve the DTO. [Existing span conversion](../../packages/telemetry-explorer/src/traces/data/repository.ts), [Attribute conversion](../../packages/telemetry-explorer/src/sql/json-attributes.ts)

Preserve existing start/end hints through the embed and adapter. `getTrace` already requires a bounded window because trace ID is not a sort-key prefix. A bare trace-ID route cannot silently discard that context, especially for old traces. Validate span focus, pop-out links, clipboard URLs, error/loading behavior, and organization switching. [Current reads](../../packages/telemetry-explorer/src/traces/data/repository.ts), [Current query options](../../packages/telemetry-explorer/src/traces/data/options.ts)

Per `schema-pk-filter-on-orderby` and `query-index-skipping-indices`, any redesign of trace lookup must validate filter alignment and actual index pruning. Retaining the existing bounded reads avoids introducing an unbounded lookup as part of the UI change; this research does not establish their runtime performance. [Filter rule](../../.agents/skills/clickhouse-best-practices/rules/schema-pk-filter-on-orderby.md), [Skipping-index rule](../../.agents/skills/clickhouse-best-practices/rules/query-index-skipping-indices.md)

Desktop is the main uncertainty. It obtains local data through a Tauri command, not normal HTTP, so an unmodified iframe cannot directly use its repository. The spike must prove either a controlled iframe transport bridge or a local compatibility endpoint and packaged asset delivery. A cloud-only implementation does not solve local trace viewing. [Local SQL client](../../packages/desktop-app/src/features/logs/local-sql-client.ts)

Replacing shared `TraceExplorer` covers the explorer hosts; the CI run waterfall is separate and needs explicit follow-up if included. No collector, ingestion, or database migration is inherent in this approach. [Shared detail](../../packages/telemetry-explorer/src/traces/ui/trace-explorer/trace-viewer.tsx), [Run waterfall](../../packages/app/src/components/run-detail/trace-waterfall.tsx)

## Estimates and proof points

These are planning estimates for one engineer, not measured commitments:

| Scope | Estimate | Condition |
| --- | --- | --- |
| Spike with one real trace in web and desktop | 1 to 2 days | Prove data fidelity and desktop transport before committing |
| Production trace detail replacement in both hosts | 1 to 3 weeks | Narrow adapter, existing search, manageable desktop bridge |
| Native React extraction | Several weeks, potentially 4 to 8 | Additional ownership of state, layout, styles, and upstream updates |

The spike should record bundle cost, large-trace responsiveness, keyboard/resize behavior, event/link accuracy, old-trace deep links, and tenant isolation. Production maintenance means pinning the UI artifact, keeping any fork small, verifying adapter compatibility on upgrades, and manually checking both hosts. Full Jaeger search would add service/operation/search endpoint support and translation of Everr filters; it is a separate scope decision.
