import { ErrorIssueSearchSchema } from "@everr/telemetry-explorer/errors";
import { LogsSearchFiltersShape } from "@everr/telemetry-explorer/logs";
import { TraceSearchParamsSchema } from "@everr/telemetry-explorer/traces";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ExploreSearchSchema, ExploreSearchShape } from "@/lib/explore-search";
import { TimeRangeSearchSchema } from "@/lib/time-range";

// Regression test for: service/environment being stripped by child-route
// validateSearch when navigating between Explore sections.
//
// Root cause: child schemas used .omit({ service: true }) (and never included
// environment), so Zod's strict object stripping discarded those params on
// arrival at the leaf route. The fix spreads ExploreSearchShape into every
// child schema, mirroring how TimeRangeSearchSchema carries from/to.
//
// These schemas are reconstructed exactly as the route files define them so we
// can test the schemas in isolation without pulling in the route files'
// transitive server-side imports (remoteRepo → server.ts).

// Mirrors logs.tsx SearchSchema
const LogsSearchSchema = TimeRangeSearchSchema.extend({
  q: z.string().optional(),
  ...LogsSearchFiltersShape,
  ...ExploreSearchShape,
  traceId: z.string().optional(),
  showVolume: z.boolean().default(true),
}).omit({ services: true });

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
