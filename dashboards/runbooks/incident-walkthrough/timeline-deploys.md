# Deploy history

Release checks per service — each cell is one deploy's post-rollout health
check:

```panel
kind: Panel
height: 260
spec:
  display: { name: "Post-deploy checks" }
  plugin:
    kind: StatusHistory
    spec: { showValues: true }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: table
            seed: 35
            rows: 18
            columns:
              - { name: ts, time: true }
              - { name: api,    values: [pass, pass, pass, pass, fail, pass] }
              - { name: db,     values: [pass, pass, warn, pass, pass, pass] }
              - { name: worker, values: [pass, warn, pass, pass, pass, pass] }
```

## Releases in the window

```panel
kind: Panel
height: 280
spec:
  display: { name: "Releases" }
  plugin:
    kind: Table
    spec: {}
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: csv
            columns: [time, service, version, change]
            rows:
              - ["13:42", db, "2026.6.9", "ANALYZE after orders index rebuild skipped"]
              - ["13:05", api, "v341", "checkout: retry budget added"]
              - ["11:50", worker, "v89", "queue consumer parallelism 4 → 8"]
              - ["09:12", web, "v1022", "copy changes"]
```

**Root cause (in this demo scenario):** the `db 2026.6.9` migration rebuilt
the `orders` index but skipped `ANALYZE`; the planner fell back to a
sequential scan under load. The fix was a manual `ANALYZE orders` plus a
migration-template change so it can't be skipped again.
