import { ShellSearchSchema, shellRouteOptions } from "@everr/app-shell/shell";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DashboardLayout } from "#app/components/dashboard-layout.tsx";

const DashboardSearchSchema = ShellSearchSchema.extend({
  github_install: z.string().optional(),
  reason: z.string().optional(),
  // Active preview (a preview/branch name). App-wide context: retained across
  // navigation (below) so the whole app stays in the same preview until the
  // user switches back to Live. Absent = Live. Bounded here (matching the
  // server's previewNameSchema cap) and coerced to Live on anything oversized,
  // so retainSearchParams can't carry a junk value around; control-character
  // rejection stays authoritative on the server at apply time.
  preview: z.string().max(200).optional().catch(undefined),
  // Dashboard variable values, e.g. ?vars={"env":"prod","svc":["a","b"]}.
  // Deliberately NOT retained across navigation — different dashboards have
  // different variables. Malformed values fall back to spec defaults.
  vars: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .catch(undefined),
});

// Named before it is spread: router/create-route-property-order throws on a
// spread that is not an identifier (https://github.com/TanStack/router/issues/8673).
const shell = shellRouteOptions({ retain: ["preview"] });

export const Route = createFileRoute("/_authenticated/_organization/_dashboard")({
  ...shell,
  validateSearch: DashboardSearchSchema,
  component: DashboardLayout,
});
