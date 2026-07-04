# Table

Renders query rows as a plain table. Columns and their order come entirely from the `SELECT`; there is no column, formatting, sort, or pagination configuration.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `stickyHeader` | boolean | `false` | `true` | Keep the header row visible while the body scrolls. Only the literal `true` enables it. |

```yaml
plugin:
  kind: Table
  spec: { stickyHeader: true }
```

`stickyHeader` is the only option. There is **no** `columns`, `columnSettings`, `unit`, `format`, `sort`, `align`, `pagination`, `pageSize`, or `density`.

## Data shape

Any columns. They render **as-is, in `SELECT` order**, with the column alias as the header. There is no type-aware formatting:

- **Numbers are not formatted** — no thousands separators, rounding, units, or alignment. Format in SQL: `round(quantile(0.95)(Duration) / 1e6, 1) AS p95_ms`. Convey the unit through the alias or panel title; a literal "ms" suffix is not rendered.
- **`NULL` cells render the literal text `NULL`** (muted). Use `coalesce` / `ifNull` in SQL if you want blanks or a placeholder.

## Behaviors to know

- **Multiple queries** show a `Query A` / `Query B` / … toggle and display one query at a time — they are not merged.
- **An empty result** shows a "no data" placeholder.
