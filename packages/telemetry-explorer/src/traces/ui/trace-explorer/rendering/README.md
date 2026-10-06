# Trace rendering

Adapted from upstream trace visualization code at commit `32350e61e565b7f267d7f92354f782b439b8b138`. See the root `NOTICE` for source attribution. The original MIT Expat license is retained in `LICENSE`.

## Ported code

- `compute-visual-layout.ts`: overlap-aware subtree placement from `TraceFlamegraph/computeVisualLayout.ts`.
- `draw-utils.ts`, `constants.ts`, and `use-flamegraph-draw.ts`: canvas rendering from `TraceFlamegraph`, including selection, filtering, event markers, and visible-row culling.
- `waterfall-utils.ts`: collapse and ancestor traversal from `TraceWaterfall/utils.ts`, with a cycle guard.
- `../waterfall.tsx`: adapted waterfall row composition, using Everr controls and React Virtuoso rather than the upstream table, virtualizer, global store, and backend pagination.

## Everr integration

The shared viewer reads spans through the repository supplied by its host. The cloud web app supplies its authenticated remote trace repository; the CLI webapp supplies its local SQL trace repository. Selection is controlled by the `span` URL parameter. Both views share selection, filters, color grouping, and the visible time range. Service colors come from Everr's shared `serviceColor` function and CSS palette; the canvas resolves those CSS variables before drawing. Error outlines, overlays, and event markers use Everr's destructive token. Relative times are computed with BigInt before conversion to drawing coordinates. Event markers use the viewport transformation so clipping a bar does not move its events.

The spike includes synchronized flamegraph and waterfall selection, collapse/expand, text and attribute-value search, error highlighting, category filters, attribute previews, zoom/pan, and attributes/events/links in a resizable detail panel. Parent-child guides appear only for hovered or explicitly selected spans, and off-screen guides are omitted instead of clamped to the viewport edge. Flamegraph, waterfall, and details use Everr's shared ScrollArea. Search is case-insensitive text matching, not the upstream query expression language.

It does not include backend span windowing, percentile queries, related logs/metrics panels, service execution-time analytics, floating/bottom docking, or worker-based layout computation. It loads the complete result of Everr's existing bounded trace query. Large-trace behavior must be measured separately before treating this as a production-scale replacement.

The cloud and CLI webapps use the same viewer. The separate run detail waterfall retains its existing implementation.
