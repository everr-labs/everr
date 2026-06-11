import * as z from "zod";

/** One resource in the apply state: its repo-relative path and raw contents. */
export const resourceEntrySchema = z.object({
  path: z.string().min(1),
  // Raw parsed YAML/JSON; deep-validated per kind by that kind's reconciler.
  resource: z.unknown(),
});

export type ApplyResourceEntry = z.infer<typeof resourceEntrySchema>;

const applySourceSchema = z
  .object({
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    remote: z.string().min(1).optional(),
  })
  .strict();

export type ApplySource = z.infer<typeof applySourceSchema>;

export const applyInput = z
  .object({
    // Stable repository identifier from everr.yaml — the apply ownership and
    // prune boundary. Resources from other repoids are never touched.
    repoid: z.string().min(1),
    state: z
      .object({
        dashboards: z.array(resourceEntrySchema),
        alerts: z.array(resourceEntrySchema),
      })
      .strict(),
    source: applySourceSchema.optional(),
    /** When true, compute and return the diff without writing. */
    dryRun: z.boolean().default(false),
  })
  .strict();

export type ApplyInput = z.infer<typeof applyInput>;
