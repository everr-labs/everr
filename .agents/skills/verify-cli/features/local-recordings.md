# Local recordings

Browser recording Segments sent to the local OTLP endpoint land in the `recordings` table, not in `logs`, with the same columns as the server table except `tenant_id` and `retention_days`. A malformed attribute stores a fallback value and never rejects the request.

## Sub-features

- `rec-route` a Segment (log event `everr.browser.recording.segment`) is stored in `recordings`, every other log in `logs`.
- `rec-columns` `segment_end`, `clip_start`, `clip_id`, `trigger`, `truncated` read the `everr.recording.*` attributes.
- `rec-fallback` missing, text, negative, `9e18`, and nested values store `''`, `0`, `false`, or the epoch.
- `rec-clips` the Clip listing groups a Stream's Segments by `clip_start`.
- `rec-pruning` a `Timestamp` filter reads the hour of the sort key.
- `rec-zone` a machine time zone other than UTC does not hide rows near a day or hour boundary.

## How to get to it (user POV)

- `@everr/otel-web` posts gzipped OTLP/HTTP logs to `http://127.0.0.1:54318/v1/logs`.
- `everr local query "<SQL>"` reads `recordings`. Never select `Body` of a real Segment: it is up to 950 KB.

## Driving it with verify-cli

Preconditions:

- `$V doctor` ends with `DOCTOR OK`.
- `M=verify-$(date +%s)`; the marker is the stream id, so old rows cannot satisfy a check.

- **Send.** Post five Segments for the stream `$M`: an opening one (body `[]`, with a Clip id and trigger), a normal one, a duplicate of it, a closing `[]` one, and a hostile one with a text `everr.recording.segment.end` and a `9e18` `everr.recording.clip.start`.

  ```bash
  ( eval "$($V env)"
    now=$(date +%s)000000000; ms=$(date +%s)000
    seg() { printf '{"timeUnixNano":"%s","eventName":"everr.browser.recording.segment","body":{"stringValue":"%s"},"attributes":[{"key":"everr.recording.stream.id","value":{"stringValue":"%s"}},{"key":"everr.recording.segment.index","value":{"intValue":"%s"}},%s]}' "$now" "$1" "$M" "$2" "$3"; }
    start='{"key":"everr.recording.clip.start","value":{"intValue":"'$ms'"}}'
    end='{"key":"everr.recording.segment.end","value":{"intValue":"'$ms'"}}'
    open='{"key":"everr.recording.clip.id","value":{"stringValue":"c1"}},{"key":"everr.recording.trigger","value":{"stringValue":"error"}}'
    bad='{"key":"everr.recording.segment.end","value":{"stringValue":"soon"}},{"key":"everr.recording.clip.start","value":{"doubleValue":9e18}}'
    recs="$(seg '[]' 0 "$start,$end,$open"),$(seg '[{}]' 1 "$start,$end"),$(seg '[{}]' 1 "$start,$end"),$(seg '[]' 2 "$start,$end"),$(seg '[]' 3 "$bad")"
    curl -s -H 'Content-Type: application/json' "$EVERR_OTLP_HTTP_ORIGIN/v1/logs" \
      --data '{"resourceLogs":[{"resource":{"attributes":[]},"scopeLogs":[{"logRecords":['"$recs"']}]}]}' )
  ```

  The response is `{"partialSuccess":{}}`.
- **Route.** `$V cli-until rec-route "$M" -- local query "SELECT stream_id, count() AS n FROM recordings WHERE stream_id = '$M' GROUP BY stream_id" --format ndjson` prints `"n":5`. `SELECT count() AS n FROM logs WHERE EventName = 'everr.browser.recording.segment'` prints `{"n":0}`.
- **Columns and fallbacks.** `$V cli rec-columns -- local query "SELECT segment_index, toUnixTimestamp64Milli(segment_end) AS segment_end, toUnixTimestamp64Milli(clip_start) AS clip_start, clip_id, trigger, truncated FROM recordings WHERE stream_id = '$M' ORDER BY Timestamp, segment_index" --format ndjson`. The Segment with the text end and the `9e18` start has `segment_end` and `clip_start` `0`.
- **Clips.** `$V cli rec-clips -- local query "SELECT stream_id, clip_start, max(segment_end) AS clip_end, argMinIf(clip_id, segment_index, clip_id != '') AS opened_id, argMinIf(trigger, segment_index, clip_id != '') AS opened_trigger FROM recordings WHERE stream_id = '$M' GROUP BY stream_id, clip_start" --format ndjson`. One row per `clip_start`.
- **Pruning.** `$V cli rec-explain -- local query "EXPLAIN indexes = 1 SELECT count() FROM recordings WHERE Timestamp >= now() - INTERVAL 1 HOUR AND Timestamp <= now()" --format table`. The `PrimaryKey` block lists `toStartOfHour(Timestamp, 'UTC')`.
- **Zone.** Launch with `TZ=Asia/Kolkata $V launch`, then `$V cli rec-zone -- local query "SELECT serverTimezone() AS machine, timezone() AS session" --format ndjson` prints `"machine":"Asia/Kolkata","session":"UTC"`. Post Segments 0.1 s either side of 2026-11-20 00:00:00 UTC and of 18:30:00 UTC, stop and start the instance (`$V cli stop -- local stop`, then `TZ=Asia/Kolkata $V cli start -- local start --detach --no-open`), and filter with `Timestamp >= toDateTime64('2026-11-19 23:59:59', 9, 'UTC') AND Timestamp < toDateTime64('2026-11-20 00:00:01', 9, 'UTC')`: both rows come back.
- **Proof.** The `cli/rec-*` folders.

## Gotchas

- An output alias equal to a column name (`argMinIf(clip_id, ...) AS clip_id`) fails with `ILLEGAL_AGGREGATION` when a second aggregate in the same query reads that column. Alias the aggregates differently.
- `Timestamp >= '2026-11-20 00:00:00'` is read in the machine time zone after a restart on a machine that is not on UTC. Use `toDateTime64(..., 9, 'UTC')` or `parseDateTime64BestEffort` of an ISO string with `Z`.
- Observed on 2026-11-20: after a restart under `TZ=Asia/Kolkata`, rows of `logs` and `traces` written just before a UTC midnight are missing from an explicit UTC `Timestamp` filter (partition pruning by local date). `recordings` is not affected. See `EVERR_CHANGES.md` in the chDB exporter.
