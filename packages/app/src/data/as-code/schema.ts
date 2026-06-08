// packages/app/src/data/as-code/schema.ts
import * as z from "zod";

/** A single document in an apply request: its relative path and raw contents. */
const applyDocumentSchema = z.object({
  path: z.string().min(1),
  // Raw parsed YAML/JSON; validated per-document by the kind's reconciler.
  document: z.unknown(),
});

export const applyInput = z.object({
  source: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Source must use lowercase letters, digits and hyphens",
    ),
  documents: z.array(applyDocumentSchema),
  /** When true, compute and return the diff without writing. */
  dryRun: z.boolean().optional(),
});
