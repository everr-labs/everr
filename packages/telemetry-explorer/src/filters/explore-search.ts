import { z } from "zod";

// Optional values preserve cross-page filters while explicit empty arrays clear them.
export const ExploreSearchShape = {
  service: z.array(z.string()).optional().catch(undefined),
  environment: z.array(z.string()).optional().catch(undefined),
} as const;

export const ExploreSearchSchema = z.object(ExploreSearchShape);
