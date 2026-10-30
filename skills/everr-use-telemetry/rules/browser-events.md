# Browser Events From @everr/otel-web

Use this rule when investigating web-app behavior: page views, clicks, web vitals, frontend errors, browser-issued requests, or session recordings. It catalogs everything the `@everr/otel-web` SDK emits so you can filter by real names instead of guessing.

## Where Browser Data Lands

- Everything except requests is a **log record** in `logs` with the event name in the `EventName` column. A log emitted during `startActiveSpan`, until `end()`, carries that span's `TraceId`, `SpanId`, and `TraceFlags`. Clicks, submits, and web vitals use the time of the event, so they join only a span that was already active then. Any log joins whichever span is active, including a span from another interaction.
- Browser `fetch` and XHR requests are **CLIENT spans** in `traces`. Slow interactions and custom segments from the exported `tracer` are **INTERNAL spans**.
- Every record (logs and spans) carries the context envelope in its attributes map, so any signal can slice by page and join by session.

## The Context Envelope (on every record)

| Attribute              | Meaning                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `session.id`           | Rotates after 30 idle minutes; groups one visit                          |
| `everr.visitor.id`     | Stable per browser (localStorage); groups return visits                  |
| `everr.page_view.id`   | Joins any record to the pageview it happened on                          |
| `url.full`, `url.path` | The page the record happened on                                          |
| `everr.route.pattern`  | Low-cardinality route, e.g. `/posts/{id}`; group by this, not `url.path` |
| `everr.referrer.url`   | The page's referrer                                                      |
| `user.id`, `user.*`    | Set by `identify()`; flat traits like `user.plan`                        |
| ambient `everr.*` keys | Set by the host app via `setAttributes()`                                |

## Resource Attributes (in `ResourceAttributes`)

`service.name`, `service.version`, `service.namespace` (= `everr`), `service.instance.id`, `deployment.environment.name`, `telemetry.distro.name` (= `@everr/otel-web`, the reliable "this came from a browser" filter), `telemetry.distro.version`, `user_agent.original`, `browser.language`, `everr.screen.width`/`height`, `everr.timezone`, `everr.landing.url`, `everr.landing.path`, and `everr.utm.source`/`medium`/`campaign`/`term`/`content` (only the params present on the landing query string; organic traffic carries none).

## Log Events (`EventName` column)

| EventName                          | Meaning                                                                            | Key attributes                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `everr.browser.page_view`          | One per hard navigation and per SPA navigation                                     | `everr.navigation.type` (`initial` or `history_change`) |
| `everr.browser.page_leave`         | One per pageview, on navigation away or hide                                       | `everr.page_view.duration` (ms)                         |
| `everr.browser.interaction.click`  | Autocaptured click                                                                 | element attrs                                           |
| `everr.browser.interaction.submit` | Form submit, targeted at the submit button                                         | element attrs                                           |
| `browser.web_vital`                | One per metric (lcp, cls, ttfb, inp) per navigation                                | see below                                               |
| `exception`                        | Frontend error (unhandled, unhandled rejection, React boundary, or manual capture) | see below                                               |

Element attributes, shared by everything that names a DOM element: `everr.element.selector` (stable CSS path, the one spelling across all signals: nearest `#id` anchor, then per step a naming attribute (`aria-label`, `type`, `name`, `title`, `alt`) and digit-free classes on the tag, positional `:nth-of-type` only as a last resort), `everr.element.tag`, `everr.element.href`, `everr.viewport.width`/`height`. The SDK never captures element text or input values.

### Web vitals

Semconv names stay bare: `browser.web_vital.name` (`lcp`, `cls`, `ttfb`, `inp`), `browser.web_vital.value` (ms, except cls which is unitless), `browser.web_vital.delta` (always equal to value: one record per metric per navigation), `browser.web_vital.id`. Everr additions on every vital: `everr.browser.web_vital.rating` (`good`, `needs-improvement`, `poor`) and `everr.browser.web_vital.navigation_type`.

Attribution for LCP, CLS, and TTFB rides under `everr.browser.web_vital.<metric>.*`:

| Metric | Attribution attributes (`everr.browser.web_vital.<metric>.` prefix)                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lcp`  | `target` (element selector), `url` (resource url), `time_to_first_byte`, `resource_load_delay`, `resource_load_duration`, `element_render_delay`                      |
| `cls`  | `largest_shift_target` (element selector), `largest_shift_time`, `largest_shift_value`, `load_state` (`loading`, `dom-interactive`, `dom-content-loaded`, `complete`) |
| `ttfb` | `waiting_duration`, `cache_duration`, `dns_duration`, `connection_duration`, `request_duration`                                                                       |

The INP vital does not use that prefix. It carries the same attribution as the `slow_interaction` span, under the same names: `everr.browser.interaction.*` (`name`, `type`, phases, `total_*` breakdown, `script.*`) plus element attrs. `everr.browser.interaction.id` joins the vital to the `slow_interaction` span of the same interaction.

### Exceptions

`exception.type`, `exception.message`, `exception.stacktrace`, `everr.error.mechanism` (`onerror`, `unhandledrejection`, `react`; a manual `captureError` record carries no mechanism), `everr.react.component_stack` (React boundaries only). These are error logs (`SeverityNumber >= 17`), so the fingerprint grouping in SKILL.md applies to them unchanged.

### Recording Segments

Only with `recording()` from `@everr/otel-web/recording`. Each Clip is sent as one or more `everr.browser.recording.segment` logs. The `Body` is a JSON array of rrweb events that is already masked; the first Segment of a Clip starts with a Meta event and a full snapshot. A Segment holds about 950 KB, or one larger event alone, and its `Timestamp` is that of its last event. Join the Segments of a Clip by `everr.recording.clip.id` and order them by `everr.recording.segment.index`. A gap in the index is a request that was lost or dropped at page exit.

| Attribute                       | Meaning                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `everr.recording.clip.id`       | Random id per Clip; also on the `recording` span                          |
| `everr.recording.stream.id`     | Random id per page's buffer; on every record of the page while it buffers |
| `everr.recording.segment.index` | Int from 0 per Clip                                                       |
| `session.id`                    | The Session the Stream started in, not a fresh read                       |

Segments carry the rest of the context envelope, but no `TraceId` or `SpanId`: join a Clip to other signals by `session.id`, `everr.recording.stream.id`, and time. An rrweb custom event with tag `everr.recording.oversized` inside the body marks where the recorder stopped for the rest of the page, because one event was over 10 MB.

## Spans (in `traces`)

| SpanName                                           | Meaning                                                                                                                                                                                                                                                                                                                              | Key attributes                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application-defined name (e.g. `prepare checkout`) | Manual segment from `tracer.startSpan()` or `tracer.startActiveSpan()`. The latter stays active until `end()` in the browser; custom and built-in spans started during that time join the most recently active span's trace. Overlapping interactions share this stack, not isolated async contexts. `root: true` starts a new trace | Context envelope plus caller-supplied attributes (a scalar or an array). Prefer bounded names and `everr.*` for custom attributes. `setStatus({ code: 2 })` marks failure (`StatusCode = 'Error'`, message kept). `setStatus({ code: 1 })` marks OK and sticks. Links carry the linked span's trace id, span id, and trace flags                                                                                                                                      |
| `<METHOD> <route>` (e.g. `GET /api/posts/{id}`)    | One per browser `fetch` or XHR; the server spans parent to it, so `TraceId` joins frontend to backend. Each request is its own trace root                                                                                                                                                                                            | HTTP client semconv: `http.request.method`, `http.response.status_code`, `url.full` (query-stripped request URL), `url.template`, `server.address`; 4xx/5xx set `StatusCode = 'Error'` with `error.type`                                                                                                                                                                                                                                                              |
| `recording`                                        | One root span per Clip, the index entry for its Segments. It starts at the Clip's requested start (the `startClip()` call, or `last` ms before it) and ends at `end()`, `next`, the 60-second cap, or page hide. It never has a parent, and nothing is a child of it                                                                 | `everr.recording.trigger` (`error`, `network`, or `manual`), `everr.recording.clip.id`, `everr.recording.stream.id`, `everr.recording.clip.truncated` (`true` only when the buffer did not reach back to the requested start), `session.id`                                                                                                                                                                                                                           |
| `slow_interaction`                                 | Event Timing entry over threshold, from the same observer as INP                                                                                                                                                                                                                                                                     | `everr.browser.interaction.*`: `id`, `name` (event name, e.g. `click`), `type` (`pointer` or `keyboard`), `input_delay`, `processing_duration`, `presentation_delay`, `total_script_duration`, `total_style_and_layout_duration`, `total_paint_duration`, `total_unattributed_duration`, `script.source_url`, `script.function_name`, `script.invoker_type`, `script.duration` (the longest script; script and total attrs need Chrome 123+ LoAF); plus element attrs |

XHR spans start at `send()` and end on completion, timeout, network failure, or cancellation. Network failures set `error.type = NetworkError`; timeouts set `error.type = TimeoutError`. Explicit aborts and requests replaced by `open()` end without an error status. A missing HTTP response has no `http.response.status_code`. Shutdown detaches listeners and discards unfinished XHR observations without aborting application requests. Everr owns XHR trace propagation. Caller-supplied `traceparent` headers are not detected; setting one alongside `network()` causes XHR to append the SDK value, producing an invalid trace header.

## Example Queries

Web-vital p75 by route (one row per metric per route):

```sql
SELECT toString(LogAttributes.`everr.route.pattern`) AS route,
  toString(LogAttributes.`browser.web_vital.name`) AS vital,
  quantile(0.75)(toFloat64OrZero(toString(LogAttributes.`browser.web_vital.value`))) AS p75,
  count() AS samples
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND EventName = 'browser.web_vital'
GROUP BY route, vital
ORDER BY route, vital
LIMIT 50
```

Slow interactions by element, to find UI that stalls:

```sql
SELECT toString(SpanAttributes.`everr.route.pattern`) AS route,
  toString(SpanAttributes.`everr.element.selector`) AS selector,
  count() AS slow_interactions
FROM traces
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND SpanName = 'slow_interaction'
GROUP BY route, selector
ORDER BY slow_interactions DESC
LIMIT 20
```

Frontend error rate by page:

```sql
SELECT toString(LogAttributes.`everr.route.pattern`) AS route,
  countIf(EventName = 'exception') AS errors,
  countIf(EventName = 'everr.browser.page_view') AS views
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND EventName IN ('exception', 'everr.browser.page_view')
GROUP BY route
ORDER BY errors DESC
LIMIT 20
```

Recordings of the last day with what opened them; play one by reading its Segments in index order:

```sql
SELECT Timestamp, Duration / 1e9 AS seconds,
  toString(SpanAttributes.`everr.recording.trigger`) AS trigger,
  toString(SpanAttributes.`everr.recording.clip.id`) AS clip_id,
  toString(SpanAttributes.`session.id`) AS session_id
FROM traces
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND SpanName = 'recording'
ORDER BY Timestamp DESC
LIMIT 20
```

```sql
SELECT toUInt32OrZero(toString(LogAttributes.`everr.recording.segment.index`)) AS segment, Body
FROM logs
WHERE EventName = 'everr.browser.recording.segment'
  AND toString(LogAttributes.`everr.recording.clip.id`) = '<clip-id>'
ORDER BY segment
```

What one user session did, in order (events and requests interleaved):

```sql
SELECT * FROM (
  SELECT Timestamp, EventName AS what, toString(LogAttributes.`url.path`) AS path
  FROM logs
  WHERE Timestamp > now() - INTERVAL 24 HOUR
    AND toString(LogAttributes.`session.id`) = '<session-id>'
  UNION ALL
  SELECT Timestamp, SpanName, toString(SpanAttributes.`url.full`)
  FROM traces
  WHERE Timestamp > now() - INTERVAL 24 HOUR
    AND toString(SpanAttributes.`session.id`) = '<session-id>'
)
ORDER BY Timestamp ASC
LIMIT 200
```
