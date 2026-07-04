# NodeGraph

A **directed graph of nodes and weighted edges** with a deterministic force-directed layout — service dependency maps, call graphs, data flows. The query returns an **edge list**: one row per edge with a source column, a target column, and an optional numeric weight. Nodes are derived from the distinct endpoints and sized by the total weight flowing through them; edge thickness tracks the edge's weight.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `sourceColumn` | string | `source` | column name | Edge source column; falls back to the first column when absent. |
| `targetColumn` | string | `target` | column name | Edge target column; falls back to the second column when absent. |
| `valueColumn` | string | `value` | column name | Edge weight column — drives edge thickness and node size. Falls back to the first remaining numeric column; without one every edge weighs 1. |
| `unit` | string | `""` | any | Value formatting in tooltips and edge labels. |
| `directed` | boolean | `true` | `false` | Draw arrowheads pointing at each edge's target. |
| `showValues` | boolean | `false` | `true` | Render the edge's value at its midpoint. |
| `maxNodes` | number | unset | ≥ 2 | Keep only the `maxNodes` highest-value nodes (and the edges between them); the rest are hidden behind a "not shown" badge. There is also a built-in 250-node layout limit. |

```yaml
plugin:
  kind: NodeGraph
  spec:
    sourceColumn: client
    targetColumn: server
    valueColumn: calls
    unit: req
```

There is **no** node coloring/grouping option, no separate nodes query, no pinning, and no layout option — nodes are derived from the edge rows only.

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

- Multiple queries are allowed — edges with the same (source, target) pair **sum across them**, just as duplicate rows sum within one query.

## Behaviors to know

- **Direction matters:** `a → b` and `b → a` are distinct edges; both render, offset so neither hides the other. Set `directed: false` for symmetric relations to drop the arrowheads.
- **Self-loops and rows missing either endpoint are dropped** and counted in the panel's "not shown" badge — filter them in SQL (`WHERE source != target`) if you don't want the badge.
- **Node value = sum of all touching edge weights** (in + out); the tooltip also shows the in/out edge counts.
- Keep **node cardinality low** (≲ 50 for readability; hard layout cap at 250) — `GROUP BY` to coarse entities (services, not endpoints) and `LIMIT` in SQL, or set `maxNodes` to keep the heaviest nodes.
- Without a numeric column every edge weighs 1, so a plain two-column edge list still sizes nodes by edge count.
- Use `unit` for the tooltip/edge-label formatting; format anything fancier in SQL (the weight must stay numeric).
