import { describe, expect, it } from "vite-plus/test";
import { buildOccurrencesQuery, buildServicesQuery, buildSummaryQuery } from "./issues";

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
  withRecording: false,
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
    expect(sql).toContain("has(ResourceAttributesKeys, {attrKey0:String})");
    expect(params.attrKey0).toBe("deployment.environment");
    expect(params.attrVals0).toEqual(["prod"]);
  });

  it("threads attribute clauses into the services query", () => {
    const { sql } = buildServicesQuery(
      {
        ...base,
        attributes: [{ source: "log", key: "http.method", op: "exists", values: [] }],
      },
      "logs",
    );
    expect(sql).toContain("has(LogAttributesKeys, {attrKey0:String})");
  });

  it("omits attribute clauses when none are given", () => {
    const { params } = buildSummaryQuery({ ...base }, "logs");
    expect(params.attrKey0).toBeUndefined();
  });
});

describe("recording filter", () => {
  const exceptionLogs = (sql: string) => sql.split("exception_logs AS (")[1]?.split("\n      )")[0];

  it("reads recording Clips only when the filter is on", () => {
    const off = buildSummaryQuery({ ...base, withRecording: false }, "logs");
    const on = buildSummaryQuery({ ...base, withRecording: true }, "logs");

    expect(off.sql).not.toMatch(/recording/);
    expect(exceptionLogs(on.sql)).toContain("SpanName = 'recording'");
    expect(exceptionLogs(on.sql)).toContain("everr.recording.stream.id");
    expect(on.params).toEqual(off.params);
  });

  it("scopes an Error's occurrences the same way", () => {
    const detail = { ...base, fingerprint: "fp", occurrenceLimit: 50 };
    const off = buildOccurrencesQuery({ ...detail, withRecording: false }, "logs");
    const on = buildOccurrencesQuery({ ...detail, withRecording: true }, "logs");

    expect(off.sql).not.toMatch(/recording/);
    expect(exceptionLogs(on.sql)).toContain("SpanName = 'recording'");
  });
});
