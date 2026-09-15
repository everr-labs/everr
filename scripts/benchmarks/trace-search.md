# Trace search benchmark

## Recommendation

Use the two-stage raw-span query as the next implementation candidate. It
preserved results in all tested scenarios and substantially reduced the cost of
broad searches. Keep the existing trace-window table for known-ID lookups; its
whole-second timestamps cannot directly select a precise search page.

The runner does not modify application code, local collector data, or schemas.

## Measured results, September 15, 2026

Times below are medians in milliseconds after warm-up. Variants ran sequentially
in a deterministic shuffled order. Each query's complete returned rows were
compared with the current repository query, preserving result order and ignoring
the unspecified ordering inside service arrays.

### Real local collector data

152,082 spans and 18,706 traces in the fixed seven-day window ending at
`2026-09-15 12:13:22.825000000`. ClickHouse version 26.5.1.1. Five measured runs
per variant. Timings include CLI startup, local HTTP transport, and JSON parsing;
they are not database-only execution times.

| Scenario | Current | Two-stage | Trace-window lookup |
| --- | ---: | ---: | ---: |
| Seven days, all | 71.2 | 20.1 | 18.2 |
| One hour, all | 13.2 | 13.8 | 13.6 |
| Seven days, service filter | 17.6 | 18.5 | Not applicable |
| Seven days, errors | 70.0 | 19.6 | Not applicable |
| Seven days, minimum duration | 71.1 | 22.5 | Not applicable |
| Seven days, missing attribute | 26.9 | 25.7 | Not applicable |
| Seven days, page two | 73.5 | 20.7 | Not applicable |

All compared rows matched on this dataset. The error query returned only two
traces. The service filter selected `everr-dev-app-web`.

### Isolated synthetic ClickHouse data

1,000,075 spans and 100,075 traces. ClickHouse version 26.7.2.1 (embedded chDB),
seven measured runs per variant. Timings include the synchronous chDB call and
JSON parsing. The main fixture contains ten spans per trace, twenty services,
two insertion batches per trace, child-span errors, varied durations, and traces
with and without `http.route`. An additional 75 roots start within one second to
test page selection at subsecond precision.

| Scenario | Current | Two-stage | Trace-window lookup |
| --- | ---: | ---: | ---: |
| Seven days, all | 190.0 | 23.5 | 32.0, wrong results |
| One hour, all | 11.6 | 8.4 | 21.2, wrong results |
| Seven days, service filter | 47.2 | 22.4 | Not applicable |
| Seven days, errors | 190.0 | 26.8 | Not applicable |
| Seven days, minimum duration | 191.4 | 29.5 | Not applicable |
| Seven days, missing attribute | 83.9 | 29.1 | Not applicable |
| Seven days, page two | 196.6 | 28.6 | Not applicable |

Two-stage returned identical rows in every scenario. On the seven-day unfiltered
query, engine-reported bytes read fell from 105,158,780 to 29,486,810 (72% less).
Rows read increased from 1,000,075 to 1,055,196 because of the second pass. The
gain comes from reading fewer expensive columns across the full window and
computing full summaries only for the page.

The lookup variant orders candidates by `min(Start), TraceId`. `Start` is stored
at whole-second precision, so the 75 recently started traces tie on time and
lexical ID order selects a different set of 50 than the real nanosecond ordering.
Fetching full summaries afterward cannot recover excluded IDs.

## What is compared

1. **Current:** SQL captured from `TracesRepository.search()` at baseline commit
   `795604e7a06d9623f441fe7ab2dcc23cc2857e8e` with a recording SQL client.
2. **Two-stage:** SQL captured from this checkout's implementation. Preserve
   the original WHERE, HAVING, cursor, and ordering while
   selecting 50 IDs with only the aggregates required for selection. Then compute
   the original full summaries for those IDs, using the same time window. Both
   stages run in one SQL statement. Error HAVING uses `countIf`; duration HAVING
   retains the duration aggregate. Attribute/service filters stay before LIMIT.
3. **Trace-window lookup:** for unfiltered first-page searches only, select 50 IDs
   from overlapping `traces_trace_id_ts` rows, then calculate full raw-span
   summaries. This is an intentionally unproven alternative, not production code.

The synthetic raw-span table mirrors the relevant production types, partition
key, sort key, and skip indexes. A view applies a fixed tenant predicate in place
of a row policy. The trace-window table and MV reproduce batch aggregation,
whole-second timestamps, monthly partitioning, and ID-oriented ordering. TTL is
omitted so fixed fixtures cannot expire. Only one tenant is populated.

## Reproduce

Requires Node, esbuild, and the app's installed chDB dependency. The script uses
an isolated temporary database and removes it after the run. It does not write
to the local collector or production.

```bash
bash scripts/benchmarks/trace-search.sh

# Read-only queries against the running local collector:
BENCH_OUT=/tmp/everr-trace-search-live.json \
  bash scripts/benchmarks/trace-search.sh --live
```

If this checkout has no dependencies, set `BENCH_DEPS_ROOT` to a worktree with
installed dependencies. The measured run used:

```bash
BENCH_DEPS_ROOT=/Users/gio/workspace/everr-labs/everr \
  bash scripts/benchmarks/trace-search.sh
```

`BENCH_SPANS` controls the synthetic base span count (default 1,000,000, plus 75
precision fixtures). `BENCH_REPEATS` defaults to seven. `BENCH_OUT` defaults to
`/tmp/everr-trace-search-benchmark.json`. The JSON includes SQL, individual timings,
row equality, and engine read statistics where available. The live run pins its
window to the newest local span; later runs can therefore use a different window.
`BENCH_BASE_REF` overrides the baseline revision (it must use the original query
shape). The baseline repository is bundled from Git into a temporary file, so
the runner never overwrites the working implementation.

The tables above record the original experiment. A subsequent five-run check
of the implemented query returned the same rows in all seven scenarios and
measured 188.5ms for the baseline versus 23.3ms for the implementation on the
million-span seven-day search, with the same bytes read.

## Limits and next validation

These are warm local microbenchmarks, not a prediction that production's five
seconds will fall by the same factor. Local and synthetic engines differ in
version, schema details, data distribution, storage, and concurrency. The local
collector may ingest late spans during a run; equality checks help detect that.
Small or selective searches can lose about a millisecond to the extra stage.

Before shipping, exercise more combinations of filters and boundary-spanning
traces, then compare production query plans and bytes read on the same inputs.
The current cursor semantics are preserved by this experiment, not independently
proved correct. This benchmark does not evaluate a new summary MV, cold storage,
or concurrent load.

## ClickHouse rules checked

- `schema-pk-filter-on-orderby`: the benchmark reproduces tenant/service/time
  ordering; the existing lookup remains ordered for trace IDs rather than time.
- `query-index-skipping-indices`: existing trace-ID and attribute-key indexes are
  retained; no new indexes are proposed. Read statistics measure the actual scan.
- `query-join-filter-before`: page selection keeps filters before LIMIT; these
  variants use IN subqueries and introduce no JOIN algorithm choice.
- `query-mv-incremental`: existing lookup aggregation is reproduced. A richer
  summary MV remains a separate design and was not benchmarked here.
