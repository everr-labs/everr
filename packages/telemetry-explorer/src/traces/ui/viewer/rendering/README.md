# Trace rendering

Adapted trace layout and canvas rendering. See the root `NOTICE` for the pinned upstream source and attribution; `LICENSE` retains the original MIT Expat license.

Rendering uses Everr service colors and visible-row culling. Span times and event offsets use BigInt arithmetic before conversion to drawing coordinates.

Model preparation and flamegraph layout run in module workers, with a synchronous fallback when workers are unavailable. Layout is computed only when the flamegraph opens. The viewer uses the existing bounded full-trace query.

Remaining gaps from the pinned upstream implementation:

- Progressive span loading and windowed queries for large traces.
- Query-expression filtering, beyond text search and category/error highlighting.
- Related logs, span duration percentiles, and service execution-time analytics.
- Pinned attributes, attribute filter/group actions, multiple preview fields, and dynamic color-by fields.
- Bottom/floating detail panes and saved display preferences.
- Richer hover cards and a waterfall crosshair (the flamegraph has a time guide).
- CSV/JSONL export and trace-funnel actions.

Representative large-trace benchmarks remain outside this spike.
