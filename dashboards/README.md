# Dashboards (as-code)

Everr dashboards defined as code (Perses-format YAML), reconciled into Everr with `everr apply`.

- `everr.yaml` — manifest declaring the reconcile scope (`projects: [demo]`). Required at this directory's root.
- One `*.yaml` per dashboard. The filename's directory becomes the UI folder path; these sit at the root.

All dashboards here belong to the **`demo`** project → URLs are `/dashboards/demo/<slug>`.

| File | Slug | Demonstrates |
| --- | --- | --- |
| `web-http-overview.yaml` | web-http-overview | TimeSeries method pivot, multi-series percentiles, StatChart+sparkline, Table, query-backed multi-select variable |
| `postgres-performance.yaml` | postgres-performance | Operation pivot, StatCharts w/ thresholds, statement table, TextVariable + ListVariable combined |
| `errors-and-logs.yaml` | errors-and-logs | Cross-table (traces + logs), error-rate %, severity pivot, service variable spanning both tables |
| `ci-activity.yaml` | ci-activity | StatusCode pivot, durations in seconds, **static** list variable, p50/p95/max series |
| `service-health-stats.yaml` | service-health-stats | **Multi-tile StatCharts**: multi-column query, SQL-pivot by label, and multi-query panels |
| `nodejs-runtime.yaml` | nodejs-runtime | **OTel metrics** (`metrics_gauge`/`_sum`/`_histogram`): event loop, V8 heap by space, GC, HTTP histograms, CPU/mem, DB pool — `avgIf` multi-metric pulls, unit conversions, histogram `sum(Sum)/sum(Count)` |

## Apply

```sh
# preview (writes nothing)
everr-dev apply ./dashboards --dry-run

# apply (delete-by-default within the declared projects)
everr-dev apply ./dashboards --yes
```

Authoring reference: the bundled `everr-write-dashboards` skill
(`crates/everr-core/assets/skills/everr-write-dashboards/SKILL.md`), and the docs
under `packages/docs/content/docs/dashboards/`.
