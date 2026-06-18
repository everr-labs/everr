import { z } from "zod";

// Shared shape for the Explore section's cross-page filters (Service +
// Environment). Spread into the `authenticated` layout (where the sidebar lives
// and `retainSearchParams` runs) AND every explore page schema so a page's
// validateSearch never strips them on arrival.
//
// Declared WITHOUT `.default([])` on purpose — the default is the difference
// between a filter you can clear and one you can't:
//
//   - `retainSearchParams` only refills keys ABSENT from the destination search.
//     With a default, every destination already carries `[]`, so retain can
//     never fire and cross-page persistence silently breaks.
//   - With the key optional, an unset filter is genuinely absent — retain copies
//     the live value across navigation — while an explicit clear (`service: []`)
//     stays present so `stripSearchParams` can drop it as a default, yielding a
//     clean URL that reflects the cleared state.
//
// `.optional().catch(undefined)` leaves the key absent when unset and tolerates
// malformed URLs. Read sites coalesce to `[]` (e.g. `service ?? []`).
export const ExploreSearchShape = {
  service: z.array(z.string()).optional().catch(undefined),
  environment: z.array(z.string()).optional().catch(undefined),
} as const;

export const ExploreSearchSchema = z.object(ExploreSearchShape);
