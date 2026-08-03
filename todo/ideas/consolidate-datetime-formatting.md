# Consolidate duration formatting and timestamp handling

## What
Two distinct datetime problems: duration formatting is implemented five times across three packages, and timestamp parsing/formatting is scattered (raw `new Date(...)` on server strings, per-file `toLocaleString` options) despite `@everr/ui/lib/timestamp.ts` existing for exactly this.

## Where
Duration formatters:
- `packages/ui/src/lib/formatting.ts` `formatDuration` / `formatDurationCompact`: the canonical pair, but `formatDuration` caps at minutes (no hours/days), which is why the others exist.
- `packages/telemetry-explorer/src/runs/ui/runs-results-list.tsx` `formatRunDuration`: near-exact duplicate of ui `formatDuration`.
- `packages/app/src/data/alerts/window.ts` `formatDurationSeconds`: exact round-trippable as-code units (`7d`, never `6d 24h`). Distinct semantics, keep.
- `packages/app/src/data/cc/slo.ts` `ccFormatSloDuration`: mirrors the engine's `fmt_duration_secs` (two largest non-zero units, `3d 4h`). Distinct semantics, keep.

Timestamps:
- `packages/ui/src/lib/timestamp.ts` has `parseTimestampAsUTC` (ClickHouse timestamps carry no timezone), `formatTimestampTimeOfDay`, `formatRelativeTime`, but only 7 files import the parser.
- 73 call sites do raw `new Date(...)` on data (some legit date arithmetic; the parse-a-server-string cases risk the local-vs-UTC bug).
- ~35 files hand-pick their own `toLocaleString` / `Intl.DateTimeFormat` options for table cells and axis ticks (`ccFormatTs` in the alerts shared components, `cost-analysis/format-bucket.ts`, every telemetry-explorer list/histogram, dashboard visualizations).

## Why it matters
The duration gap means every new surface showing spans over an hour rolls its own formatter, and the five existing ones disagree on style. The timestamp scatter means the same instant renders differently across tables, and every raw `new Date(...)` on a ClickHouse string is a latent UTC bug `parseTimestampAsUTC` was written to prevent.

## Sketch
- Teach ui `formatDuration` the "two largest non-zero units" behavior (hours/days); delete telemetry-explorer's `formatRunDuration`. Leave `formatDurationSeconds` (as-code round-trip) and `ccFormatSloDuration` (engine-mirroring) alone: they are semantics, not duplication.
- Add a small formatting family to `ui/lib/timestamp.ts` (full, short/table, time-of-day already exists) and sweep the `toLocaleString` call sites onto it.
- Audit the 73 raw `new Date(` sites; route the ones parsing server timestamps through `parseTimestampAsUTC`. Needs per-site judgment, not a mechanical replace.

## Related
Sibling of `serverfn-org-id-on-context.md`: both came out of the same "what else is worth generalizing" sweep after the alerting components move. The component-level candidates live in `generalize-alerting-components.md`.
