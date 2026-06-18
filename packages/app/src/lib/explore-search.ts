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
