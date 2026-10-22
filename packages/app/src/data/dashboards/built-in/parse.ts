import { parse } from "yaml";
import { z } from "zod";
import { dashboardFromResource } from "../normalize";
import { dashboardSlugSchema, dashboardSpecSchema } from "../schema";
import { BUILTIN_CATEGORIES, type BuiltinDashboard, SIGNALS } from "./types";

const builtinDashboardSchema = z.strictObject({
  id: dashboardSlugSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(BUILTIN_CATEGORIES),
  requires: z.array(
    z.strictObject({
      signal: z.enum(SIGNALS),
      match: z.string().min(1).optional(),
      label: z.string().min(1),
    }),
  ),
  document: z.strictObject({
    kind: z.literal("Dashboard"),
    metadata: z.strictObject({
      name: z.string(),
      project: z.string().optional(),
    }),
    spec: dashboardSpecSchema,
  }),
});

/** Parse and validate a built-in dashboard resource, then normalize its spec. */
export function parseBuiltinDashboard(source: string): BuiltinDashboard {
  const builtin = builtinDashboardSchema.parse(parse(source));
  return {
    ...builtin,
    document: dashboardFromResource(builtin.document),
  };
}
