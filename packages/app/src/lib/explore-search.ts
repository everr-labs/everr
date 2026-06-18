import { z } from "zod";

// Shared shape for the Explore section's cross-route filters. Spread into the
// `_explore` layout AND every explore child route so a child route's
// validateSearch never strips these (mirrors how TimeRangeSearchSchema carries
// from/to across all dashboard routes).
//
// Declared WITHOUT `.default([])` on purpose. The default is the difference
// between a filter you can clear and one you can't:
//
//   - `retainSearchParams` (on the `_dashboard` layout) only refills keys that
//     are ABSENT from the destination search. With a default, every destination
//     already carries `[]`, so retain can never fire and cross-route persistence
//     silently breaks.
//   - With the key optional, an unset filter is genuinely absent — retain copies
//     the live value across navigation — while an explicit clear (`service: []`)
//     stays present so `stripSearchParams` can drop it as a default. The result
//     is a clean URL that actually reflects the cleared state.
//
// `.optional().catch(undefined)` leaves the key absent when unset and tolerates
// malformed URLs. Read sites coalesce to `[]` (e.g. `service ?? []`).
export const ExploreSearchShape = {
  service: z.array(z.string()).optional().catch(undefined),
  environment: z.array(z.string()).optional().catch(undefined),
} as const;

export const ExploreSearchSchema = z.object(ExploreSearchShape);

// Backwards-compatible alias. The `_dashboard` layout (where `retainSearchParams`
// runs for the sidebar) imports this name; it is now identical to the shared
// shape since both must stay optional for retain to work.
export const ExploreSearchRetainShape = ExploreSearchShape;
