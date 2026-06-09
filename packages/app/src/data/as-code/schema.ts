import * as z from "zod";

/** A single document in an apply request: its relative path and raw contents. */
const applyDocumentSchema = z.object({
  path: z.string().min(1),
  // Raw parsed YAML/JSON; validated per-document by the kind's reconciler.
  document: z.unknown(),
});

export const applyInput = z.object({
  // Declared project scope from everr.yaml — the run's authoritative reconcile
  // scope (no implicit "default"). May be empty. Per-kind reconcilers validate
  // that every document targets a declared project.
  projects: z.array(z.string().min(1)),
  documents: z.array(applyDocumentSchema),
  /** When true, compute and return the diff without writing. */
  dryRun: z.boolean().optional(),
});
