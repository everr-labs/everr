# Browser Events From @everr/otel-web

Use this rule when investigating web-app behavior: page views, clicks, web vitals, frontend errors, or browser-issued requests. It catalogs everything the `@everr/otel-web` SDK emits so you can filter by real names instead of guessing.

## Where Browser Data Lands

- Everything except requests is a **log record** in `logs` with the event name in the `EventName` column.
- Browser `fetch` requests, slow interactions, and page-load capture are **CLIENT spans** in `traces`.
- Every record (logs and spans) carries the context envelope in its attributes map, so any signal can slice by page and join by session.

## The Context Envelope (on every record)

| Attribute | Meaning |
| --- | --- |
| `session.id` | Rotates after 30 idle minutes; groups one visit |
| `everr.visitor.id` | Stable per browser (localStorage); groups return visits |
| `everr.page_view.id` | Joins any record to the pageview it happened on |
| `url.full`, `url.path` | The page the record happened on |
| `everr.route.pattern` | Low-cardinality route, e.g. `/posts/{id}`; group by this, not `url.path` |
| `everr.referrer.url` | The page's referrer |
| `user.id`, `user.*` | Set by `identify()`; flat traits like `user.plan` |
| ambient `everr.*` keys | Set by the host app via `setAttributes()` |

## Resource Attributes (in `ResourceAttributes`)

`service.name`, `service.version`, `service.namespace` (= `everr`), `service.instance.id`, `deployment.environment.name`, `telemetry.distro.name` (= `@everr/otel-web`, the reliable "this came from a browser" filter), `telemetry.distro.version`, `user_agent.original`, `browser.language`, `everr.screen.width`/`height`, `everr.timezone`, `everr.landing.url`, `everr.landing.path`, and `everr.utm.source`/`medium`/`campaign`/`term`/`content` (only the params present on the landing query string; organic traffic carries none).

## Log Events (`EventName` column)

`Timestamp` is the time the event occurred, not the time a delayed observer reported it or a batch sent it. TTFB uses `responseStart`, LCP uses the chosen paint, CLS uses the last contributing shift in the selected session window, and INP uses the initial input. Click, change, and submit use the DOM event time. A rage click uses the first click in its burst. A custom instrumentation can pass any OpenTelemetry time input with `ctx.emit(name, attributes, timestamp)`; omission defaults to the instant `emit` is called. Records are ordered oldest to newest within each OTLP logs payload. Spans are ordered by start time within each traces payload.

| EventName | Meaning | Key attributes |
| --- | --- | --- |
| `everr.browser.page_view` | One per hard navigation and per SPA navigation | `everr.navigation.type` (`initial` or `history_change`) |
| `everr.browser.page_leave` | One per pageview, on navigation away or hide | `everr.page_view.duration` (ms), `everr.scroll.depth` (0 to 1) |
| `everr.browser.interaction.click` | Autocaptured click | element attrs, `everr.browser.click.x`/`y` |
| `everr.browser.interaction.rage_click` | 3 clicks within 30px in under 1s each | same as click |
| `everr.browser.interaction.change` | Form-field change (values never captured) | element attrs |
| `everr.browser.interaction.submit` | Form submit, targeted at the submit button | element attrs |
| `browser.web_vital` | One per metric (lcp, cls, ttfb, inp) per navigation | see below |
| `exception` | Frontend error (unhandled, unhandled rejection, React boundary, or manual capture) | see below |

Element attributes, shared by everything that names a DOM element: `everr.element.selector` (stable CSS path, the one spelling across all signals: nearest `#id` anchor, then per step a naming attribute (`aria-label`, `type`, `name`, `title`, `alt`) and digit-free classes on the tag, positional `:nth-of-type` only as a last resort), `everr.element.tag`, `everr.element.href`, `everr.viewport.width`/`height`. The SDK never captures element text or input values.

### Web vitals

Semconv names stay bare: `browser.web_vital.name` (`lcp`, `cls`, `ttfb`, `inp`), `browser.web_vital.value` (ms, except cls which is unitless), `browser.web_vital.delta` (always equal to value: one record per metric per navigation), `browser.web_vital.id`. Everr additions on every vital: `everr.browser.web_vital.rating` (`good`, `needs-improvement`, `poor`) and `everr.browser.web_vital.navigation_type`.

Attribution for LCP, CLS, and TTFB rides under `everr.browser.web_vital.<metric>.*`:

| Metric | Attribution attributes (`everr.browser.web_vital.<metric>.` prefix) |
| --- | --- |
| `lcp` | `target` (element selector), `url` (resource url), `time_to_first_byte`, `resource_load_delay`, `resource_load_duration`, `element_render_delay` |
| `cls` | `largest_shift_target` (element selector), `largest_shift_time`, `largest_shift_value`, `load_state` (`loading`, `dom-interactive`, `dom-content-loaded`, `complete`) |
| `ttfb` | `waiting_duration`, `cache_duration`, `dns_duration`, `connection_duration`, `request_duration` |

The INP vital does not use that prefix. It carries the same attribution as the `slow_interaction` span, under the same names: `everr.browser.interaction.*` (`name`, `type`, phases, `total_*` breakdown, `script.*`) plus element attrs. `everr.browser.interaction.id` joins the vital to the `slow_interaction` span of the same interaction.

### Exceptions

`exception.type`, `exception.message`, `exception.stacktrace`, `everr.error.mechanism` (`onerror`, `unhandledrejection`, `react`; a manual `captureError` record carries no mechanism), `everr.react.component_stack` (React boundaries only). These are error logs (`SeverityNumber >= 17`), so the fingerprint grouping in SKILL.md applies to them unchanged.

## Spans (in `traces`)

| SpanName | Meaning | Key attributes |
| --- | --- | --- |
| `<METHOD> <route>` (e.g. `GET /api/posts/{id}`) | One per browser `fetch`; the server spans parent to it, so `TraceId` joins frontend to backend. During the first load (while the `pageLoad` root is open) it is a child of that root and shares its `TraceId`; after that it is its own trace root | HTTP client semconv: `http.request.method`, `http.response.status_code`, `url.full` (query-stripped request URL), `url.template`, `server.address`; 4xx/5xx set `StatusCode = 'Error'` with `error.type` |
| `slow_interaction` | Event Timing entry over threshold, from the same observer as INP | `everr.browser.interaction.*`: `id`, `name` (event name, e.g. `click`), `type` (`pointer` or `keyboard`), `input_delay`, `processing_duration`, `presentation_delay`, `total_script_duration`, `total_style_and_layout_duration`, `total_paint_duration`, `total_unattributed_duration`, `script.source_url`, `script.function_name`, `script.invoker_type`, `script.duration` (the longest script; script and total attrs need Chrome 123+ LoAF); plus element attrs |
| `pageLoad` | Root of the first-load trace, from `pageLoad()`; starts at the document time origin and ends at LCP (the last `largest-contentful-paint` entry; the `load` event end in a browser without LCP; earlier if the page hides or the recording window closes first). Any span the SDK starts while it is open is its child, whatever started it (for example the `pageLoad.*` spans, a fetch and the server spans behind it, `slow_interaction`, a custom instrumentation span), so one `TraceId` groups the whole load; a child can end after the root (the root is time to LCP, the assets are the window). Absent when `pageLoad()` is not composed, or in a session `sampled()` left out | `everr.browser.page_load.end`: what ended the root. `lcp`; `load` (no LCP entry); `hidden` (page hid before both); `ceiling` (the window closed before both: `ceilingMs`, or SDK shutdown). Filter on `lcp` when the duration must mean time to LCP |
| `pageLoad.asset.<initiator_type>` (e.g. `pageLoad.asset.script`, `pageLoad.asset.img`) | Static-resource waterfall during the first load, one child of `pageLoad` per resource (often wrapped in `sampled()`, so expect a per-session fraction). The name is stable across deployments; the query-stripped resource URL is in `url.full` | `everr.browser.asset.*`: `initiator_type`, `transfer_size`, `encoded_body_size`, `decoded_body_size`, `delivery_type` (`cache` when served from cache), `render_blocking`, `dns_duration`, `connection_duration`, `tls_duration`, `request_duration`, `download_duration` |
| `pageLoad.long_animation_frame` | Main-thread stall during the first load, a child of `pageLoad` | `everr.browser.long_animation_frame.*`: `blocking_duration`, `script_duration`, `style_and_layout_duration`, `unattributed_duration`, and the longest script as `script.source_url`, `script.function_name`, `script.invoker_type`, `script.duration` |

## Example Queries

Web-vital p75 by route (one row per metric per route):

```sql
SELECT LogAttributes['everr.route.pattern'] AS route,
  LogAttributes['browser.web_vital.name'] AS vital,
  quantile(0.75)(toFloat64(LogAttributes['browser.web_vital.value'])) AS p75,
  count() AS samples
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND EventName = 'browser.web_vital'
GROUP BY route, vital
ORDER BY route, vital
LIMIT 50
```

Rage clicks by element, to find broken UI:

```sql
SELECT LogAttributes['everr.route.pattern'] AS route,
  LogAttributes['everr.element.selector'] AS selector,
  count() AS rage_clicks
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND EventName = 'everr.browser.interaction.rage_click'
GROUP BY route, selector
ORDER BY rage_clicks DESC
LIMIT 20
```

Frontend error rate by page:

```sql
SELECT LogAttributes['everr.route.pattern'] AS route,
  countIf(EventName = 'exception') AS errors,
  countIf(EventName = 'everr.browser.page_view') AS views
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND EventName IN ('exception', 'everr.browser.page_view')
GROUP BY route
ORDER BY errors DESC
LIMIT 20
```

What one user session did, in order (events and requests interleaved):

```sql
SELECT * FROM (
  SELECT Timestamp, EventName AS what, LogAttributes['url.path'] AS path
  FROM logs
  WHERE Timestamp > now() - INTERVAL 24 HOUR
    AND LogAttributes['session.id'] = '<session-id>'
  UNION ALL
  SELECT Timestamp, SpanName, SpanAttributes['url.full']
  FROM traces
  WHERE Timestamp > now() - INTERVAL 24 HOUR
    AND SpanAttributes['session.id'] = '<session-id>'
)
ORDER BY Timestamp ASC
LIMIT 200
```
