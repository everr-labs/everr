import * as z from "zod";

/** One resource in the apply state: its repo-relative path and raw contents. */
const resourceEntrySchema = z.object({
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

/**
 * Preview namespace name (usually a git branch). '' is reserved for the live
 * state, so the wire field must be non-empty when present. Control characters
 * are rejected because the name round-trips into URLs and UI labels.
 */
export const previewNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  .refine((name) => !/[\u0000-\u001f\u007f-\u009f]/.test(name), {
    message: "preview name must not contain control characters",
  });

export const applyInput = z
  .object({
    // Stable repository identifier from everr.yaml — the apply ownership and
    // prune boundary. Resources from other repoids are never touched.
    repoid: z.string().min(1),
    state: z
      .object({
        dashboards: z.array(resourceEntrySchema),
        runbooks: z.array(resourceEntrySchema),
        alerts: z.array(resourceEntrySchema),
        // Clickety-clack resources, classified CLI-side (CCAlertRule/CCReceiver).
        // Defaulted so callers/tests that omit them stay valid; the everr CLI
        // always sends both (possibly empty) arrays.
        ccRules: z.array(resourceEntrySchema).default([]),
        ccReceivers: z.array(resourceEntrySchema).default([]),
      })
      .strict(),
    source: applySourceSchema.optional(),
    /** Apply into this preview namespace instead of the live state. */
    preview: previewNameSchema.optional(),
    /** When true, compute and return the diff without writing. */
    dryRun: z.boolean().default(false),
    /** Take over live resources owned by another repo instead of failing on the
     * cross-repo ownership conflict. */
    adopt: z.boolean().default(false),
  })
  .strict();

export type ApplyInput = z.infer<typeof applyInput>;
