---
"@everr/cli": minor
---

Add `everr ci trace-snapshot` and `everr ci trace-diff`. `trace-snapshot` saves the local collector's spans to a Parquet file. `trace-diff` compares a run's traces with one or more baseline snapshots, per entry point, and reports new, removed, and changed spans and errors as markdown or JSON, with `--fail-on` to gate CI and `--ignore-span` for spans that vary with timing.
