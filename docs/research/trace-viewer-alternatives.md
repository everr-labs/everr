# OSS trace viewer alternatives

Investigated 2026-10-06. This is a shortlist for adapting a viewer into Everr's React/TypeScript stack, not a recommendation to replace its storage or ingestion. Sources track upstream main/master and should be pinned to a release before copying code. Integration rankings below are engineering judgments from source boundaries, not benchmark results.

## Shortlist

| Viewer | Native adaptation assessment | Main consideration |
| --- | --- | --- |
| Perses Tracing Gantt Chart | First candidate to spike | React component accepts OTLP trace data, Apache 2.0; still needs Perses/MUI dependency and host-navigation adaptation |
| Grafana trace view | Mature candidate, less attractive extraction boundary | React/TypeScript, Jaeger-derived timeline; Grafana runtime coupling and file-level license audit |
| Zipkin Lens | Conventional alternative to Jaeger | React SPA with TypeScript, Apache 2.0; still a whole application, not a viewer package |
| Perfetto | Optional advanced timeline/export view | TypeScript/Mithril, Apache 2.0; file and SQL analysis model, supported iframe integration |

## Perses

The core `TracingGanttChart` is a React component taking options, custom links, and OTLP `TracesData`. It owns viewport and selected-span state, combines a minimap with a searchable resizable timeline, and explicitly describes its UI/UX as based on Jaeger. This is a more direct data-in boundary than extracting a routed trace page. [Core component](https://raw.githubusercontent.com/perses/plugins/main/tracingganttchart/src/TracingGanttChart/TracingGanttChart.tsx)

Span details include attributes, events, and links. [Detail pane](https://raw.githubusercontent.com/perses/plugins/main/tracingganttchart/src/TracingGanttChart/DetailPane/DetailPane.tsx)

The plugin is Apache 2.0 and declares React 18.3 peers, Perses dependencies, and React Virtuoso. MUI/Perses imports and Everr's React version need compatibility checking. The existing initial selected-span option is not a full controlled selection interface; Everr should add selection/navigation callbacks. The core accepts data directly, so adapting it need not require a Perses backend. [Package manifest](https://raw.githubusercontent.com/perses/plugins/main/tracingganttchart/package.json), [Plugin documentation](https://perses.dev/plugins/docs/tracingganttchart/)

Assessment: the most promising first spike for native reuse. This is a source assessment, not evidence that its performance or all OTel edge cases meet Everr's needs.

## Grafana

Grafana's trace page imports Grafana runtime, data sources, UI, and application stores. Its viewer is therefore not an isolated installable component boundary. [Trace view source](https://raw.githubusercontent.com/grafana/grafana/main/public/app/features/explore/TraceView/TraceView.tsx)

The Jaeger-derived `TraceTimelineViewer` file carries Apache 2.0 attribution, while Grafana's repository root uses AGPL 3.0. Do not characterize the whole viewer as uniformly AGPL or assume every supporting file is Apache; inspect the exact copied subtree and dependency boundary. [Timeline file](https://raw.githubusercontent.com/grafana/grafana/main/public/app/features/explore/TraceView/components/TraceTimelineViewer/index.tsx), [Root license](https://raw.githubusercontent.com/grafana/grafana/main/LICENSE)

Assessment: worth inspecting for interaction ideas, but Perses offers a clearer initial data boundary. This is an engineering judgment, not a measured extraction estimate.

## Zipkin Lens

Lens is Zipkin's React SPA. Its README confirms an SVG minimap for time-window zoom and inline expandable span details. The source includes `.tsx` components and a TypeScript config. The same README states that it is published as a Maven asset JAR rather than an npm library, and development proxies requests to the Zipkin API. [Lens README and directory](https://github.com/openzipkin/zipkin/tree/master/zipkin-lens)

The repository is Apache 2.0. [License](https://github.com/openzipkin/zipkin/blob/master/LICENSE)

Assessment: a real distributed-trace alternative, but no obvious integration advantage over Jaeger. Native reuse requires extracting components and adapting the trace model/API assumptions. Source extraction does not inherently require running a Zipkin backend.

## Perfetto

Perfetto offers a browser-local timeline with keyboard zoom/pan, track selection, multiple trace formats, and SQL analysis. Its design centers on system/application trace files and tracks rather than a distributed-trace span detail page. [UI documentation](https://perfetto.dev/docs/visualization/perfetto-ui), [Project overview](https://perfetto.dev/docs/)

Its UI uses Mithril rather than React and is Apache 2.0. [UI package manifest](https://raw.githubusercontent.com/google/perfetto/main/ui/package.json)

Official integration supports an embedded iframe, a postMessage readiness handshake, raw trace bytes or streams, and externally driven zoom. [Embedding documentation](https://perfetto.dev/docs/visualization/embedding-the-ui)

Assessment: a good optional advanced timeline or export target. Adapting it into a native React distributed-trace viewer would involve a framework and data-model port; embedding it is the documented route. Everr would need to produce a supported trace format.

## Other options checked

Uptrace provides a trace waterfall and details, but its OSS frontend uses Vue 2.7, TypeScript and Vuetify, with an AGPL 3.0 repository license. It is a less direct fit for native React adaptation. Current product screenshots should not be assumed to exactly match the OSS branch. [OSS frontend manifest](https://raw.githubusercontent.com/uptrace/uptrace/master/vue/package.json), [License](https://raw.githubusercontent.com/uptrace/uptrace/master/LICENSE), [Trace product documentation](https://uptrace.dev/features/traces)

Aspire has an MIT trace detail viewer but its source is Razor/C# with Fluent UI and OTLP storage coupling. Its standalone dashboard accepts OTLP without requiring Aspire orchestration, but is intended for local development and short-term diagnostics. It is useful as UX reference or a separate local viewer, not a direct React source import. [Trace detail source](https://github.com/microsoft/aspire/blob/main/src/Aspire.Dashboard/Components/Pages/TraceDetail.razor.cs), [Standalone documentation](https://aspire.dev/dashboard/standalone/)

## Practical recommendation

Compare Perses and Jaeger on the same representative Everr traces. First prove parent hierarchy, incomplete traces, span links/events, precise timing, selection URLs, and scrolling/zoom behavior. Measure large-trace responsiveness and bundle impact in Everr before choosing. A source port can keep the existing storage, query layer, web transport, and desktop transport.
