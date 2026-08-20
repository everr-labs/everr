import { z } from "zod";
import { lastViewedStore } from "@/data/last-viewed";

/**
 * The runbook, page, and heading to reopen when `/runbooks` is visited without
 * a choice. Everything but the runbook is optional, so an entry written before
 * the reader opened a page still parses.
 *
 * Bounded because this is a value the browser hands back: an oversized entry
 * fails the schema and reads as nothing at all, which is the same as never
 * having been there. What survives the schema is still checked against the
 * runbook itself before anything is opened (see the index route).
 */
const LastViewedSchema = z.object({
  project: z.string().max(200),
  slug: z.string().max(200),
  /** Page path within the runbook, e.g. "triage/network". */
  page: z.string().max(500).optional(),
  /** Heading id on that page, without the "#". */
  hash: z.string().max(200).optional(),
});

export type LastViewedRunbook = z.infer<typeof LastViewedSchema>;

export const lastViewedRunbook = lastViewedStore("runbook", LastViewedSchema);
