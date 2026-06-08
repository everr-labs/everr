import { describe, expect, it } from "vitest";
import {
  buildOccurrencesQuery,
  buildServicesQuery,
  buildSummaryQuery,
} from "./issues";

const base = {
  fromTs: "2026-06-01 00:00:00",
  toTs: "2026-06-01 01:00:00",
  q: "",
  service: [] as string[],
  fingerprint: "",
  sort: "lastSeen" as const,
  limit: 50,
  offset: 0,
  attributes: [] as never[],
};

describe("error attribute filtering", () => {
  it("threads attribute clauses into the summary CTE with bound params", () => {
    const { sql, params } = buildSummaryQuery(
      {
        ...base,
        attributes: [
          {
            source: "resource",
            key: "deployment.environment",
            op: "in",
            values: ["prod"],
          },
        ],
      },
      "logs",
    );
    expect(sql).toContain("mapContains(ResourceAttributes, {attrKey0:String})");
    expect(params.attrKey0).toBe("deployment.environment");
    expect(params.attrVals0).toEqual(["prod"]);
  });

  it("threads attribute clauses into the services query", () => {
    const { sql } = buildServicesQuery(
      {
        ...base,
        attributes: [
          { source: "log", key: "http.method", op: "exists", values: [] },
        ],
      },
      "logs",
    );
    expect(sql).toContain("mapContains(LogAttributes, {attrKey0:String})");
  });

  it("omits attribute clauses when none are given", () => {
    const { params } = buildSummaryQuery({ ...base }, "logs");
    expect(params.attrKey0).toBeUndefined();
  });

  it("deduplicates detail occurrences by timestamp", () => {
    const { sql } = buildOccurrencesQuery(
      {
        fromTs: base.fromTs,
        toTs: base.toTs,
        service: [],
        fingerprint: "fp-1",
        occurrenceLimit: 50,
      },
      "logs",
    );
    expect(sql).toContain("row_number() OVER");
    expect(sql).toContain("PARTITION BY Timestamp");
    expect(sql).toContain("WHERE timestampRank = 1");
  });
});
