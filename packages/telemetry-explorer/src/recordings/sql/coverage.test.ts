import { describe, expect, it } from "vite-plus/test";
import { coveringClipsQuery, recordedLogPredicateSql, recordedTraceIdsSql } from "./coverage";

const bounds = { from: "{from:String}", to: "{to:String}" };

describe("coverage SQL", () => {
  it("reads Clips from the recordings table and never from a span", () => {
    const tables = { traces: "traces", recordings: "my_recordings" };
    const subject = { kind: "trace", traceId: "t" } as const;
    const sqls = [
      recordedTraceIdsSql(tables, bounds),
      recordedLogPredicateSql({ ...tables, logs: "logs" }, bounds, "1"),
      coveringClipsQuery(tables, subject).sql,
    ];
    for (const sql of sqls) {
      expect(sql).toContain("FROM my_recordings");
      expect(sql).not.toContain("SpanName");
    }
  });

  it("rejects a table name that is not an identifier", () => {
    const tables = { traces: "traces", recordings: "recordings; DROP TABLE x" };
    expect(() => recordedTraceIdsSql(tables, bounds)).toThrow("invalid table name");
    expect(() => recordedLogPredicateSql({ ...tables, logs: "logs" }, bounds, "1")).toThrow(
      "invalid table name",
    );
    expect(() => coveringClipsQuery(tables, { kind: "trace", traceId: "t" })).toThrow(
      "invalid table name",
    );
  });
});
