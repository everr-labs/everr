# Value formatting

Numeric visualizations accept `valueFormat` in `plugin.spec`. Omitting it uses an empty unit, no scaling, and at most two decimal places (trailing zeros dropped).

Use the case-sensitive UCUM codes prescribed by [OpenTelemetry instrument units](https://opentelemetry.io/docs/specs/semconv/general/metrics/#instrument-units): prefer non-prefixed units such as `By`, seconds (`s`) for durations, `1` for dimensionless utilization, and singular annotations such as `{request}` for counts. The panel must declare the unit actually returned by the query, even when that query returns a prefixed unit such as `ms`. Quote `"1"` and annotations in YAML.

Common codes receive readable display labels: `By` becomes `B`, `Cel` becomes `°C`, `us` becomes `µs`, `1` has no suffix, and `{request}` becomes `request`. These labels also work in rates with a supported time denominator, such as `By/s` and `{request}/s`. Codes remain unchanged in the configuration. Unknown expressions remain literal: this is a presentation subset, not a full UCUM validator or conversion engine. In particular, `B` is not a byte alias (UCUM defines it as bel), and `1` does not implicitly turn a fraction into a percentage.

| Field | Default | Meaning |
| --- | --- | --- |
| `unit` | `""` | UCUM/OTel code of the query result; unknown custom units remain literal labels. |
| `scale` | `none` | `none`, `decimal`, `binary`, or `duration`. |
| `decimals` | omitted | Fixed fraction digits (0 to 10); omitted uses up to 2 without trailing zeros. |
| `display` | `value` | `value` preserves ordinary unit formatting; `percent` displays a dimensionless ratio as a percentage. |

```yaml
valueFormat: { unit: "{request}/s", scale: decimal, decimals: 1 }
```

- `none`: preserve the input magnitude, e.g. `8200 connections` displays as `8,200 connections`.
- `decimal`: abbreviate in powers of 1000 (`k`, `M`, `G`, etc.). `12500 widgets/s` displays as `12.5k widgets/s`.
- With `Hz`, `W`, `J`, `V`, or `A`, decimal prefixes attach to the unit: `3200000000 Hz` displays as `3.2 GHz`, and `1500 W` as `1.5 kW`. This changes prefix placement only; values below 1000 retain their input unit, and already-prefixed inputs are not reinterpreted.
- `binary`: abbreviate in powers of 1024 (`Ki`, `Mi`, `Gi`, etc.). `2621440 By/s` displays as `2.5 MiB/s`.
- `duration`: choose a time unit from nanoseconds through days. Declare the query's actual unit: `ns`, `us`, `ms`, `s`, `min`, `h`, or `d`. With `unit: s`, `0.025` displays as `25 ms` and `90` as `1.5 min`. Other input units are rejected for duration scaling. Use the ASCII code `us`; its display label is `µs`.
- With a time unit, `decimal` selects seconds or decimal subdivisions, so `90000 ms` displays as `90 s` without advancing to minutes.
- Custom labels and rates need no registration. The query calculates the rate or percentage: `2.3` with `unit: "%"` means `2.3%`, not a fraction.
- For decimal/binary scaling, the number is in the declared unit; existing prefixes are not interpreted. Use `By` or `By/s` for bytes, and `bit` or `bit/s` for bits. These attach the display prefix to the symbol; other units keep it with the number.
- A missing label gives `12.5k`. Other labels are space-separated, except `%`.
- Time-series, bar, and gauge axes share one display scale across their ticks. Individual values and tooltips choose their own scale. Formatting never changes geometry, aggregation, or threshold comparisons; thresholds remain in input units.

Top-level `unit`, `decimals`, and `displayUnit` have been removed. Move them into `valueFormat`. For example, `unit: ms` with `decimals: 1` becomes `valueFormat: { unit: ms, decimals: 1 }`. Replace `unit: By, displayUnit: auto` with `valueFormat: { unit: By, scale: binary }`. Choose `scale: decimal` explicitly for abbreviated counts; the old implicit million/billion abbreviations no longer apply.

Table supports a panel default and `columns.<column-name>.valueFormat` overrides. An override replaces the entire default format. Only numeric cells are formatted; text and null cells retain their existing behavior.

To show an OTel utilization ratio as a percentage, use `valueFormat: { unit: "1", display: percent }`: `0.75` displays as `75%`. This requires `unit: "1"` and `scale: none` (the default). Precision applies to the displayed percentage; negative values and values above 1 are not clamped. Ordinary `unit: "1"` still displays `0.75`, while `unit: "%"` means the query already returns percentages and is not multiplied again. Gauge bounds and absolute thresholds remain raw ratios: use `max: 1` and a threshold of `0.8` for 80%. This is independent of bar stacking normalization and percent-mode thresholds.

```yaml
columns:
  throughput:
    valueFormat: { unit: "{request}/s", scale: decimal }
  bandwidth:
    valueFormat: { unit: By/s, scale: binary }
  latency:
    valueFormat: { unit: s, scale: duration }
```
