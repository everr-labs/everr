import type { TimeRange } from "@everr/ui/lib/time-range";
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
}
