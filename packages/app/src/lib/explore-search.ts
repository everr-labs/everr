import { z } from "zod";

// Shared shape for the Explore section's cross-route filters. Spread into the
// `_explore` layout AND every explore child route so a child route's
// validateSearch never strips these (mirrors how TimeRangeSearchSchema carries
// from/to across all dashboard routes).
export const ExploreSearchShape = {
  service: z.array(z.string()).catch([]).default([]),
  environment: z.array(z.string()).catch([]).default([]),
} as const;

export const ExploreSearchSchema = z.object(ExploreSearchShape);

// Retain-friendly variant for the `_dashboard` layout (where the sidebar lives
// and `retainSearchParams` must run on a sidebar click). These are declared
// WITHOUT `.default([])` on purpose: a default makes validateSearch fill `[]`
// before retainSearchParams can copy the real value from the current location,
// which silently resets the filters on navigation. `.optional().catch(undefined)`
// leaves the key absent when unset (so retain fills it) and tolerates malformed
// URLs. Read sites coalesce to `[]`; the deeper `_explore`/route schemas keep
// `.default([])` because they validate AFTER retain has populated the value.
export const ExploreSearchRetainShape = {
  service: z.array(z.string()).optional().catch(undefined),
  environment: z.array(z.string()).optional().catch(undefined),
} as const;
