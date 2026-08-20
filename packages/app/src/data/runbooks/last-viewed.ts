import { z } from "zod";
import { lastViewedStore } from "@/data/last-viewed";

/** The runbook to reopen when `/runbooks` is visited without a choice. */
const LastViewedSchema = z.object({
  project: z.string(),
  slug: z.string(),
});

export const lastViewedRunbook = lastViewedStore("runbook", LastViewedSchema);
