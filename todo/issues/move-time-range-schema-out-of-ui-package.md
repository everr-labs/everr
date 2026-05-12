## What
`TimeRangeSchema`, `resolveTimeRange`, and `toClickHouseDateTime` currently live in `packages/ui/src/lib/time-range.ts`. `@everr/ui` is a UI component package and the wrong long-term home for a zod schema and ClickHouse-flavored date helpers — they were parked there to fix a duplication between `packages/app` and `packages/logs-explorer` that arose during the logs-explorer extraction.

## Where
`packages/ui/src/lib/time-range.ts` — current home
`packages/app/src/lib/time-range.ts` — re-exports from `@everr/ui/lib/time-range`
`packages/logs-explorer/src/time-range.ts` — re-exports from `@everr/ui/lib/time-range`

## Steps to reproduce
N/A

## Expected
A neutral shared package (e.g. `@everr/time-range` or `@everr/datemath` extended) owns the schema and helpers. `@everr/ui` only owns the picker component and re-exports the `TimeRange` *type* and `DEFAULT_TIME_RANGE` constant it needs.

## Actual
`@everr/ui` now depends on `zod` and ships a non-component module under `lib/time-range.ts`. `TimeRange` and `DEFAULT_TIME_RANGE` are still defined in `components/time-range-picker.tsx` and re-exported by `lib/time-range.ts`, which is awkward.

## Priority
low

## Notes
- The duplication this consolidation fixes was previously two byte-identical copies of `TimeRangeSchema` + helpers that would have drifted silently.
- Moving to a dedicated package should be done together with deciding where `TimeRange` / `DEFAULT_TIME_RANGE` live — splitting the type from the picker component would also let the schema package avoid depending on `@everr/ui`.
- Once moved, drop the `zod` dependency from `@everr/ui/package.json`.
