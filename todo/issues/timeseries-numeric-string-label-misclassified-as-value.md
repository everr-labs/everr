## What
A grouped time-series query whose label column is a numeric string is rendered as an extra numeric series instead of pivoting into one line per label value. For example:

```sql
SELECT toStartOfMinute(Timestamp) AS ts, toString(StatusCode) AS code, count() AS count
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ts, code
ORDER BY ts
```

is expected to draw one line per status code, but instead draws two lines (`code` and `count`) because `code` is treated as a value column.

## Why
ClickHouse `JSONEachRow` quotes 64-bit integers by default (`output_format_json_quote_64bit_integers=1`), so a UInt64 aggregate and a `String` column are byte-for-byte identical in the parsed result:
- `count()` → `"42"` (a value we must plot)
- `toString(StatusCode) AS code` → `"500"` (a label we must pivot on)

The column classifier (`getValueKeys` / `getGroupKeys`) treats every numeric string as a value — deliberately, so `ts, count()` works. Per-value type sniffing cannot tell the two apart; only the row shape can (a grouped/long-format result repeats each timestamp, one row per series per bucket).

## Where
- `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-data.ts` — `getGroupKeys` / pivot detection (`groupKeys.length >= 1 && rawValueKeys.length === 1`).
- `packages/app/src/components/dashboards/visualizations/data-utils.ts` — `getValueKeys` / `isNumericValue`.

## Steps to reproduce
1. Add a time-series panel with the query above (label cast to a numeric string via `toString`).
2. Observe two numeric series (`code`, `count`) instead of one line per status code.

## Expected
One line per distinct `code`, with `count` as the plotted value.

## Actual
`code` is classified as a value column, so it renders as its own line and no pivot happens.

## Priority
low

## Notes
- Workaround today: make the label a non-numeric string (e.g. `concat('status-', toString(StatusCode))`) so it is unambiguously a dimension.
- Candidate fixes (need a structural signal, not value sniffing):
  - **Cardinality + long-format:** only when timestamps repeat, treat a low-cardinality numeric-string column that recurs across timestamps as the dimension and the high-cardinality numeric column as the value. Most robust; handles `ts,code,count` without regressing `ts,count` or `ts,p50,p95`.
  - **Positional + long-format:** when timestamps repeat and exactly one value is needed for the pivot, treat leading non-time column(s) as labels and the trailing numeric column as the value. Simpler but fragile if a query lists the value before the label.
- Surfaced during review of the dashboards (Perses) work.
