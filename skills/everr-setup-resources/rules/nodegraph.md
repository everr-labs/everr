# NodeGraph

A **directed graph of nodes and weighted edges** laid out in ranks (callers first, then the services they call; edges routed around nodes): service dependency maps, call graphs, data flows. The query returns an **edge list**: one row per edge with a source column, a target column, and an optional numeric weight. Nodes are derived from the distinct endpoints and drawn as cards with their name and value: the weight flowing through them, the larger of their total incoming and total outgoing weight. Edge thickness tracks the edge's weight.

## Options (`plugin.spec`)

| Option         | Type    | Default  | Values          | Effect                                                                                                                                                                     |
| -------------- | ------- | -------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceColumn` | string  | `source` | column name     | Edge source column; falls back to the first column when absent.                                                                                                            |
| `targetColumn` | string  | `target` | column name     | Edge target column; falls back to the second column when absent.                                                                                                           |
| `valueColumn`  | string  | `value`  | column name     | Edge weight column; drives edge thickness and node values. Falls back to the first remaining numeric column; without one every edge weighs 1.                              |
| `valueFormat`  | object  | none     | see shared rule | Numeric presentation; read `rules/value-format.md` for scaling, precision, rates and custom labels.                                                                        |
| `stats`        | array   | `[]`     | see below       | Per-edge figures (error rate, latency, …) shown on cards and tooltips, colored by optional thresholds. Read **Health stats** below.                                        |
| `linkToTraces` | boolean | `false`  | `true`          | Nodes are service names: clicking one opens Traces for that service over the dashboard's time range.                                                                       |
| `directed`     | boolean | `true`   | `false`         | Draw arrowheads pointing at each edge's target.                                                                                                                            |
| `showValues`   | boolean | `false`  | `true`          | Render the edge's value at its midpoint.                                                                                                                                   |
| `maxNodes`     | number  | unset    | ≥ 2             | Keep only the `maxNodes` highest-value nodes (and the edges between them); the rest are hidden behind a "not shown" badge. There is also a built-in 250-node layout limit. |

```yaml
plugin:
  kind: NodeGraph
  spec:
    sourceColumn: client
    targetColumn: server
    valueColumn: calls
    valueFormat:
      unit: "{request}"
```

There is **no** grouping option, no separate nodes query, and no layout options, and health colors come only from `stats` thresholds. Nodes are derived from the edge rows only.

## Data shape — an edge list, no time axis

- One row per edge: source, target, optional numeric weight. Aggregate over the window and always `LIMIT`:

```sql
SELECT ServiceName AS source,
       PeerService AS target,
       count() AS value
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
  AND PeerService != ''
GROUP BY source, target
ORDER BY value DESC
LIMIT 200
```

- For a **service map with health**, return failed calls and a latency per edge, and declare them as `stats` (see **Health stats**):

```sql
SELECT ServiceName AS source,
       PeerService AS target,
       count() AS value,
       countIf(StatusCode = 'Error') AS errors,
       round(quantile(0.9)(Duration) / 1e6, 1) AS p90_ms
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
  AND PeerService != ''
GROUP BY source, target
ORDER BY value DESC
LIMIT 200
```

- Multiple queries are allowed — edges with the same (source, target) pair **sum across them**, just as duplicate rows sum within one query.

## Behaviors to know

- **Direction matters:** `a → b` and `b → a` are distinct edges, each with its own route. Set `directed: false` for symmetric relations to drop the arrowheads.
- **Self-loops and rows missing either endpoint are dropped** and counted in the panel's "not shown" badge — filter them in SQL (`WHERE source != target`) if you don't want the badge.
- **Node value = the weight flowing through it**, the larger of its total incoming and total outgoing weight; the tooltip also shows the in/out edge counts. A node with no callers has no health of its own (grey dot).
- Keep **node cardinality low** (≲ 50 for readability; hard layout cap at 250) — `GROUP BY` to coarse entities (services, not endpoints) and `LIMIT` in SQL, or set `maxNodes` to keep the heaviest nodes.
- Without a numeric column every edge weighs 1, so a plain two-column edge list still sizes nodes by edge count.
- Use `valueFormat` for numeric presentation; keep weights numeric.

## Health stats

`stats` lists per-edge figures; a node's figures cover the calls it receives (a node nothing calls has none).

```yaml
plugin:
  kind: NodeGraph
  spec:
    valueFormat: { unit: "{request}" }
    stats:
      - column: errors
        reduce: rate
        format: { unit: "1", display: percent }
        thresholds: [0.01, 0.05]
      - column: p90_ms
        format: { unit: ms, scale: duration }
        thresholds: [250, 1000]
    linkToTraces: true
```

- **`column`** (required): the stat's column, also its label in tooltips.
- **`reduce`**: how duplicate rows and a node's incoming edges combine. `mean` (default) averages by calls: latencies, percentiles, sizes. `rate` divides the summed column by calls: a failed-call count becomes an error rate, so return the **count**, not a rate. `sum` adds it up: counts.
- **`format`**: shared value formatting; a rate is a 0 to 1 fraction, so use `{ unit: "1", display: percent }`.
- **`thresholds: [warning, critical]`**, in the stat's units after `reduce` (`[0.01, 0.05]` is 1% and 5% for a rate). Rising means higher is worse; falling (`[100, 10]`) means lower is worse, e.g. a throughput floor. Without thresholds the stat is shown but never colors anything.
- Each figure is green, amber or red by its own level; an edge or node takes the **worst** level of its stats, shown on its border and edge (healthy edges stay grey). The first `rate` stat also draws a bar under each card: red for its share, green for the rest.
- The dot before a node's name is its **service color**, the same as in Traces, never health.
