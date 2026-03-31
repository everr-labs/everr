import { describe, expect, it } from "vitest";
import { runSummarySubquery } from "./run-query-helpers";

describe("runSummarySubquery", () => {
  it("builds a minimal run summary query", () => {
    const sql = runSummarySubquery({
      whereClause: "Timestamp >= {fromTime:String}",
      groupByExpr: "TraceId",
      groupByAlias: "trace_id",
    });

    expect(sql).toContain("TraceId as trace_id");
    expect(sql).toContain("ResourceAttributes['cicd.pipeline.result']");
    expect(sql).toContain(
      "ResourceAttributes['cicd.pipeline.task.run.result']",
    );
    expect(sql).toContain("GROUP BY trace_id");
  });

  it("includes optional columns when requested", () => {
    const sql = runSummarySubquery({
      whereClause: "1 = 1",
      groupByExpr: "ResourceAttributes['cicd.pipeline.run.id']",
      groupByAlias: "run_id",
      includeRunAttempt: true,
      includeDuration: true,
      includeSender: true,
      includeJobCount: true,
    });

    expect(sql).toContain("as run_attempt");
    expect(sql).toContain("as duration");
    expect(sql).toContain("max(Duration) / 1000000 as duration");
    expect(sql).toContain("as sender");
    expect(sql).toContain("as jobCount");
  });
});
