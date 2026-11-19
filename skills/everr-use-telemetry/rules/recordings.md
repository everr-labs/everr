# Recordings: The Page A User Saw

Use this rule when a question needs the page a user saw at a moment: which elements were on it, their state, the values of the fields, and the text the app did not mask. Everything else a browser sends (page views, clicks, submits, requests, exceptions, slow interactions, vitals, page leaves) is in `logs` and `traces`. Build the timeline there with SQL, then read the page at the moments that need it:

```sh
everr cloud recording show --stream ID --at T [--html]
```

`T` is RFC 3339 with a zone (`2026-11-14T10:21:41.730Z`), epoch milliseconds, or date math (`now-6h`). Query output prints `Timestamp` without a zone, and the CLI refuses a time without one: select `toUnixTimestamp64Milli(Timestamp) AS at_ms` and pass that number.

## What A Recording Holds

A page with `recording()` keeps its Recording (the Stream) in memory and sends a Clip, a time range of the Stream, in two cases:

- Automatically around an exception, a 5xx, or a request with no response: `everr.recording.trigger` is `error` or `network`, at most 5 per page.
- Wherever the app calls `recorder.startClip()` or `recorder.emitClip()`: `trigger` is `manual`. An app can record any visit this way, failing or healthy: every checkout, a feedback button, one cohort.

Find Clips (below) shows what an app records.

Every browser record a page sends once its recorder has started carries `everr.recording.stream.id`, so that id joins a click, a request, an exception, or a vital to its Recording. The first `everr.browser.page_view` and the `ttfb` vital come before the recorder and carry none.

`show` prints the page 0.75 seconds after `--at`, read from a Clip that covers `--at`: as an outline, or as HTML with `--html`. It gives no pixels, layout, CSS, request bodies, Masked text, or telemetry.

## Workflow

1. **Timeline.** Run "What one user session did" in `rules/browser-events.md` for the session. It covers every visit, recorded or not, and gives each row's `at_ms` and `stream_id`.
2. **Moments.** Pick the rows that need the page: the exception, the end of a failed request (`at_ms + ms`), a click the user repeated or that a page leave followed.
3. **Page.** `everr cloud recording show --stream <stream_id> --at <at_ms>` for each. A `stream_id` that is empty on every row of the page means the page was not recording: report from the timeline alone.

Whether a click changed the page: read the page before it (`--at <at_ms - 1000>`) and after it (`--at <at_ms>`), and compare. On a `text masked` page, compare with `--html`: a change of Masked text shows only there, as a different run of asterisks.

## Entry Recipes

**A browser exception.** Find it with its session, stream, and time, then run the Workflow:

```sql
SELECT toUnixTimestamp64Milli(Timestamp) AS at_ms,
  toString(LogAttributes.`session.id`) AS session_id,
  toString(LogAttributes.`everr.recording.stream.id`) AS stream_id,
  toString(LogAttributes.`exception.type`) AS type,
  toString(LogAttributes.`exception.message`) AS message
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND EventName = 'exception'
  AND has(LogAttributesKeys, 'everr.recording.stream.id')
ORDER BY Timestamp DESC
LIMIT 20
```

**A backend trace that failed.** Find the browser request that started it:

```sql
SELECT toUnixTimestamp64Milli(Timestamp) AS at_ms,
  intDiv(Duration, 1000000) AS ms,
  toString(SpanAttributes.`session.id`) AS session_id,
  toString(SpanAttributes.`everr.recording.stream.id`) AS stream_id
FROM traces
WHERE Timestamp >= (SELECT min(Start) FROM traces_trace_id_ts WHERE TraceId = '<trace_id>')
  AND Timestamp <= (SELECT max(End) + 1 FROM traces_trace_id_ts WHERE TraceId = '<trace_id>')
  AND TraceId = '<trace_id>'
  AND SpanKind = 'Client'
  AND has(SpanAttributesKeys, 'session.id')
ORDER BY Timestamp
LIMIT 1
```

No row means no browser request started the trace (page loads and reloads have none): continue on the backend trace. Else `show --stream <stream_id> --at <at_ms + ms>` gives the page as the request ended.

**A failed or slow request, a `slow_interaction` span, a poor vital.** Select the record's `at_ms`, `session.id`, and `everr.recording.stream.id` the same way, then run the Workflow.

**A UX question with no session in hand** ("find UX problems in checkout"):

1. Run the population queries below, and slow interactions by element and web-vital p75 by route in `rules/browser-events.md`. They count every visit.
2. For each pattern, read the page on its example row, at most five: `show --stream <example_stream_id> --at <example_at_ms>`, and 1 second before it to see what the click changed.
3. For flows the app records on purpose, Find Clips with `trigger = 'manual'` on the route, and run the Workflow on one `session_id` per flow.
4. Report each issue with its evidence: the query row, the time, the element, and how many sessions it rests on.

## Find Clips

Clips are the `recording` spans in `traces`:

```sql
SELECT toString(SpanAttributes.`everr.recording.clip.id`) AS clip_id,
  toString(SpanAttributes.`everr.recording.stream.id`) AS stream_id,
  toString(SpanAttributes.`everr.recording.trigger`) AS trigger,
  toUnixTimestamp64Milli(Timestamp) AS start_ms,
  start_ms + intDiv(Duration, 1000000) AS end_ms,
  coalesce(nullIf(toString(SpanAttributes.`everr.route.pattern`), ''), toString(SpanAttributes.`url.path`)) AS route_at_close,
  toString(SpanAttributes.`session.id`) AS session_id
FROM traces
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND SpanName = 'recording'
  AND has(SpanAttributesKeys, 'everr.recording.clip.id')
ORDER BY Timestamp DESC
LIMIT 30
```

Narrow it with `AND trigger = 'manual'`, `AND route_at_close LIKE '/checkout%'`, or `AND stream_id = '<stream_id>'`. The route is the page when the Clip closed. A Clip starts at the last full snapshot before what opened it, which can be hours earlier: for one moment you already know, pass it to `show --at` instead. Clip counts are not a rate, since Clips exist only where the app's triggers fired.

## Population Queries

These count a pattern over every visit, recorded or not. An `example_stream_id` and `example_at_ms` pair feeds `show --stream ... --at ...`; an empty `example_stream_id` means no matching page was recording.

Repeated clicks, 3 or more on one element within 2 seconds. `rapid_clicks` counts the clicks that were the third or later of such a run, so 4 quick clicks give 2:

```sql
SELECT route, selector,
  uniqExact(session_id) AS sessions,
  count() AS rapid_clicks,
  argMaxIf(stream_id, at_ms, stream_id != '') AS example_stream_id,
  maxIf(at_ms, stream_id != '') AS example_at_ms
FROM (
  SELECT toString(LogAttributes.`session.id`) AS session_id,
    coalesce(nullIf(toString(LogAttributes.`everr.route.pattern`), ''), toString(LogAttributes.`url.path`)) AS route,
    toString(LogAttributes.`everr.element.selector`) AS selector,
    toString(LogAttributes.`everr.recording.stream.id`) AS stream_id,
    toUnixTimestamp64Milli(Timestamp) AS at_ms,
    lagInFrame(toUnixTimestamp64Milli(Timestamp), 2) OVER (
      PARTITION BY session_id, selector ORDER BY Timestamp
      ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS third_click_back_ms
  FROM logs
  WHERE Timestamp > now() - INTERVAL 24 HOUR
    AND EventName = 'everr.browser.interaction.click'
    AND has(LogAttributesKeys, 'everr.element.selector')
)
WHERE third_click_back_ms > 0 AND at_ms - third_click_back_ms <= 2000
GROUP BY route, selector
ORDER BY sessions DESC
LIMIT 20
```

An exception within 2 seconds after a click, by the clicked element:

```sql
SELECT c.route AS route, c.selector AS selector, e.type AS exception_type,
  count() AS exceptions,
  uniqExact(e.session_id) AS sessions,
  argMaxIf(e.stream_id, e.at_ms, e.stream_id != '') AS example_stream_id,
  maxIf(e.at_ms, e.stream_id != '') AS example_at_ms
FROM (
  SELECT toString(LogAttributes.`session.id`) AS session_id, Timestamp,
    toUnixTimestamp64Milli(Timestamp) AS at_ms,
    toString(LogAttributes.`everr.recording.stream.id`) AS stream_id,
    toString(LogAttributes.`exception.type`) AS type
  FROM logs
  WHERE Timestamp > now() - INTERVAL 24 HOUR AND EventName = 'exception'
    AND has(LogAttributesKeys, 'session.id')
) AS e
ASOF JOIN (
  SELECT toString(LogAttributes.`session.id`) AS session_id, Timestamp,
    toUnixTimestamp64Milli(Timestamp) AS at_ms,
    coalesce(nullIf(toString(LogAttributes.`everr.route.pattern`), ''), toString(LogAttributes.`url.path`)) AS route,
    toString(LogAttributes.`everr.element.selector`) AS selector
  FROM logs
  WHERE Timestamp > now() - INTERVAL 24 HOUR AND EventName = 'everr.browser.interaction.click'
    AND has(LogAttributesKeys, 'everr.element.selector')
) AS c
ON e.session_id = c.session_id AND e.Timestamp >= c.Timestamp
WHERE e.at_ms - c.at_ms <= 2000
GROUP BY route, selector, exception_type
ORDER BY sessions DESC
LIMIT 20
```

## Reading `show`

```text
page 2026-11-14T10:21:42.480Z (--at +0.75s) url="/checkout" text masked
main
  h1
  form#payment
    input name="email" type="email" value="****************"
    button type="submit" disabled
  ul#items
    li ×3
```

- The first line is the moment read and the page's path, then notes. `text masked`: the app masks text, so an element shows no text of its own (`--html` shows the asterisks). `coverage incomplete`: a Segment is missing or too large to read, or a change named an element the copy did not have, so parts of the page can be wrong.
- Each line is an element: `tag#id`, its naming attributes, its state (`disabled`, `checked`, a state class as `class="is-loading"`), then its text in quotes. Indentation is nesting. Wrappers with nothing to name them are left out.
- A `value` of asterisks is a filled field whose value is Masked; its length is what was typed.
- `×N` is N identical siblings. `... N more siblings` and `... N more lines` mark what did not fit.
- The outline is built from the DOM, not from layout: an element hidden by CSS still appears.

Page text can hold personal data the app did not mask. In reports, tickets, and commits, refer to the time and the element instead of copying that text.

## Local

`show` reads Cloud only. Locally, the timeline, Find Clips, and the population queries work unchanged on `everr local query`.

## Errors

Every other message names its own next move.

| Message says                     | Next move                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `MiB of Segments`                | The page is too large to read. Say so, and continue with the timeline.                             |
| `This installation may predate`  | The server is older than the CLI. Say so, and continue with the timeline from `everr cloud query`. |
| `cut short`, or `read took over` | Retry once. If it fails again, report the error.                                                   |
