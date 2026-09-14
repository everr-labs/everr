# Table

Renders query rows as a plain table. Columns and their order come entirely from the `SELECT`; numeric presentation supports a panel default and column overrides.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `stickyHeader` | boolean | `false` | `true` | Keep the header row visible while the body scrolls. Only the literal `true` enables it. |
| `valueFormat` | object | none | see shared rule | Default numeric format; read `rules/value-format.md`. |
| `columns` | map | `{}` | column name to `{ valueFormat }` | Override the default format for a named column. |

```yaml
plugin:
  kind: Table
  spec: { stickyHeader: true }
```

Read `rules/value-format.md` when configuring numeric formatting. Sorting and pagination remain unconfigured.

## Data shape

Any columns. They render **as-is, in `SELECT` order**, with the column alias as the header. Numeric cells can use the shared format:

- Numbers default to at most two decimal places. Panel and column `valueFormat` options control precision, units, and scaling. String values are preserved, including numeric strings.
- **`NULL` cells render the literal text `NULL`** (muted). Use `coalesce` / `ifNull` in SQL if you want blanks or a placeholder.

## Behaviors to know

- **Multiple queries** show a `Query A` / `Query B` / … toggle and display one query at a time — they are not merged.
- **An empty result** shows a "no data" placeholder.
