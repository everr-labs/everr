import { ErrorIssueSearchSchema } from "@everr/telemetry-explorer/errors";
import { ExploreSearchSchema, ExploreSearchShape } from "@everr/telemetry-explorer/filters";
import { LogsSearchSchema } from "@everr/telemetry-explorer/logs";
import { TraceSearchParamsSchema } from "@everr/telemetry-explorer/traces";
import { expect, it } from "vite-plus/test";

// Regression test for: service/environment being stripped by child-route
// validateSearch when navigating between Explore sections.
//
// Root cause: child schemas used .omit({ service: true }) (and never included
// environment), so Zod's strict object stripping discarded those params on
// arrival at the leaf route. The fix spreads ExploreSearchShape into every
// child schema, mirroring how TimeRangeSearchSchema carries from/to.
//
// Use shared schemas, composing the remaining route-specific Explore fields,
// without pulling in the route files'
// transitive server-side imports (remoteRepo → server.ts).

// Mirrors errors.tsx RouteSearchSchema
const ErrorsSearchSchema = ErrorIssueSearchSchema.extend(ExploreSearchShape);

// Mirrors traces.tsx RouteSearchSchema
const TracesSearchSchema = TraceSearchParamsSchema.extend(ExploreSearchShape);

const INPUT = {
  service: ["api"],
  environment: ["prod"],
};

it.each([
  ["logs", LogsSearchSchema],
  ["errors", ErrorsSearchSchema],
  ["traces", TracesSearchSchema],
  ["_explore layout", ExploreSearchSchema],
] as const)("%s schema preserves service and environment", (_name, schema) => {
  const out = schema.parse(INPUT);
  expect(out.service).toEqual(["api"]);
  expect(out.environment).toEqual(["prod"]);
});
