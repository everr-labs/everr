import { z } from "zod";
import { lastViewedStore } from "@/data/last-viewed";

/** The dashboard to reopen when `/dashboards` is visited without a choice. */
const LastViewedSchema = z.union([
  z.object({ kind: z.literal("built-in"), slug: z.string() }),
  z.object({ kind: z.literal("own"), project: z.string(), slug: z.string() }),
]);

export type LastViewedDashboard = z.infer<typeof LastViewedSchema>;

export const lastViewedDashboard = lastViewedStore(
  "dashboard",
  LastViewedSchema,
);
