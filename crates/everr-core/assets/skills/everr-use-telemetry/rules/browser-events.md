# Browser Events From @everr/otel-web

Use this rule when investigating web-app behavior: page views, clicks, web vitals, frontend errors, or browser-issued requests. It catalogs what the `@everr/otel-web` SDK emits so you can filter by real names instead of guessing.

Names below are curated, not exhaustive, and were verified against the SDK source as of this commit. If a filter returns nothing, sample rows before concluding the data is missing: `SELECT EventName, LogAttributes FROM logs WHERE ... LIMIT 5`.

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

Resource attributes (in `ResourceAttributes`): `service.name`, `service.version`, `deployment.environment.name`, `everr.landing.url`, `everr.landing.path`, `everr.utm.*` (campaign attribution), `everr.screen.width`/`height`, `everr.timezone`, and `telemetry.distro.name` = `@everr/otel-web` (the reliable "this came from a browser" filter).

## Log Events (`EventName` column)

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

Element attributes, shared by everything that names a DOM element: `everr.element.selector` (stable CSS path, the one spelling across all signals), `everr.element.tag`, `everr.element.text`, `everr.element.href`, `everr.viewport.width`/`height`.

### Web vitals

Semconv names stay bare: `browser.web_vital.name` (`lcp`, `cls`, `ttfb`, `inp`), `browser.web_vital.value` (ms, except cls which is unitless), `browser.web_vital.id`. Everr additions: `everr.browser.web_vital.rating` (`good`, `needs-improvement`, `poor`) and `everr.browser.web_vital.navigation_type`. Per-metric attribution rides under `everr.browser.web_vital.<metric>.*` (for example `lcp.target`, `cls.largest_shift_target`, `ttfb.request_duration`, `inp.*` mirroring the interaction attrs); sample a row to see what a given metric carries.

### Exceptions

`exception.type`, `exception.message`, `exception.stacktrace`, `everr.error.mechanism` (`onerror`, `unhandledrejection`, `react`, `manual`), `everr.react.component_stack` (React boundaries only). These are error logs (`SeverityNumber >= 17`), so the fingerprint grouping in SKILL.md applies to them unchanged.

## Spans (in `traces`)

| SpanName | Meaning | Key attributes |
| --- | --- | --- |
| `<METHOD> <route>` (e.g. `GET /api/posts/{id}`) | One per browser `fetch`; the browser is the trace root the server spans parent to, so `TraceId` joins frontend to backend | HTTP client semconv: `http.request.method`, `http.response.status_code`, `url.full` (query-stripped request URL), `url.template`, `server.address`; 4xx/5xx set `StatusCode = 'Error'` with `error.type` |
| `slow_interaction` | Event Timing entry over threshold, from the same observer as INP | `everr.browser.interaction.*` (`id`, `type`, `input_delay`, `processing_duration`, `presentation_delay`, `script.*`) plus element attrs; `everr.browser.interaction.id` joins it to the INP vital |
| `GET asset:<initiator_type> <url>` | Static-resource waterfall during the first load, from `pageLoad()` (often wrapped in `sampled()`, so expect a per-session fraction) | `everr.browser.asset.*` (`initiator_type`, `transfer_size`, `render_blocking`, per-phase durations) |
| `long_animation_frame` | Main-thread stall during the first load, from `pageLoad()` | `everr.browser.long_animation_frame.*` (`blocking_duration`, `script_duration`, `script.source_url`) |

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
  LogAttributes['everr.element.text'] AS text,
  count() AS rage_clicks
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND EventName = 'everr.browser.interaction.rage_click'
GROUP BY route, selector, text
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
