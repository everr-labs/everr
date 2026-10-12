import { ErrorIssueSearchSchema } from "@everr/telemetry-explorer/errors";
import {
  ExploreSearchSchema,
  ExploreSearchShape,
} from "@everr/telemetry-explorer/filters";
import { LogsSearchSchema } from "@everr/telemetry-explorer/logs";
import { TraceSearchParamsSchema } from "@everr/telemetry-explorer/traces";
import { describe, expect, it } from "vitest";

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

describe("explore child route schemas preserve service and environment", () => {
  it("logs schema preserves service and environment", () => {
    const out = LogsSearchSchema.parse(INPUT);
    expect(out.service).toEqual(["api"]);
    expect(out.environment).toEqual(["prod"]);
  });

  it("errors schema preserves service and environment", () => {
    const out = ErrorsSearchSchema.parse(INPUT);
    expect(out.service).toEqual(["api"]);
    expect(out.environment).toEqual(["prod"]);
  });

  it("traces schema preserves service and environment", () => {
    const out = TracesSearchSchema.parse(INPUT);
    expect(out.service).toEqual(["api"]);
    expect(out.environment).toEqual(["prod"]);
  });
});

// Belt-and-suspenders: the _explore layout schema also preserves them.
describe("_explore layout schema preserves service and environment", () => {
  it("validateSearch keeps service and environment", () => {
    const out = ExploreSearchSchema.parse(INPUT);
    expect(out.service).toEqual(["api"]);
    expect(out.environment).toEqual(["prod"]);
  });
});
