import { type TimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";

// Superset of every domain's attribute maps. Logs/errors use resource|log|scope;
// traces use resource|span. Validation is permissive; each domain restricts
// which sources it offers in the UI and maps to columns in SQL.
export const AttributeSourceSchema = z.enum([
  "resource",
  "log",
  "scope",
  "span",
]);
export type AttributeSource = z.infer<typeof AttributeSourceSchema>;

export const AttributeOpSchema = z.enum(["in", "not_in", "exists", "missing"]);
export type AttributeOp = z.infer<typeof AttributeOpSchema>;

export const AttributeFilterSchema = z.object({
  source: AttributeSourceSchema,
  key: z.string().min(1),
  op: AttributeOpSchema,
  values: z.array(z.string()).default([]),
});
export type AttributeFilter = z.infer<typeof AttributeFilterSchema>;

// Per-domain `attributes` field. Each domain only supports a subset of sources
// (logs/errors: resource|log|scope; traces: resource|span); a saved filter or
// URL carrying an unsupported source must be rejected at the validation
// boundary rather than throwing later in the column mapper. The element type
// stays the shared AttributeFilter (superset) so a narrowed source union does
// not ripple through the UI and data layers.
export function attributesField(allowed: readonly AttributeSource[]) {
  const supported = new Set<AttributeSource>(allowed);
  return z
    .array(AttributeFilterSchema)
    .default([])
    .refine((filters) => filters.every((f) => supported.has(f.source)), {
      message: `attribute source must be one of: ${allowed.join(", ")}`,
    });
}

export interface AttributeKey {
  source: AttributeSource;
  key: string;
}

export interface AttributeKeysInput {
  timeRange: TimeRange;
}

export interface AttributeValuesInput {
  timeRange: TimeRange;
  source: AttributeSource;
  key: string;
  // Optional server-side substring filter on the value, for high-cardinality
  // attributes whose values fall past the discovery cutoff.
  search?: string;
}

// Per-domain server-fn validator for value discovery. Like attributesField, it
// rejects a source the domain doesn't support at the validation boundary
// instead of letting the column mapper throw. The inferred `source` stays the
// wide AttributeSource (refine, not a narrowed enum) so the inferred input type
// remains assignable to AttributeValuesInput.
export function attributeValuesInputSchema(
  allowed: readonly AttributeSource[],
) {
  const supported = new Set<AttributeSource>(allowed);
  return z
    .object({
      timeRange: TimeRangeSchema,
      source: AttributeSourceSchema,
      key: z.string().min(1),
      search: z.string().optional(),
    })
    .refine((input) => supported.has(input.source), {
      message: `attribute source must be one of: ${allowed.join(", ")}`,
      path: ["source"],
    });
}
