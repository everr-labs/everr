import { describe, expect, it } from "vitest";
import { buildWhereClause } from "./where";

describe("buildWhereClause", () => {
  it("starts with the time-range bounds", () => {
    const sql = buildWhereClause({ levels: [], services: [], repos: [] });
    expect(sql).toContain(
      "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    );
    expect(sql).toContain(
      "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
    );
  });

  it("adds positionCaseInsensitive when query is set", () => {
    const sql = buildWhereClause({
      query: "boom",
      levels: [],
      services: [],
      repos: [],
    });
    expect(sql).toContain("positionCaseInsensitive(Body, {query:String}) > 0");
  });

  it("filters levels when present and includeLevels is not false", () => {
    const sql = buildWhereClause({
      levels: ["error"],
      services: [],
      repos: [],
    });
    expect(sql).toContain("IN {levels:Array(String)}");
  });

  it("omits the levels filter when includeLevels is false", () => {
    const sql = buildWhereClause({
      levels: ["error"],
      services: [],
      repos: [],
      includeLevels: false,
    });
    expect(sql).not.toContain("{levels:Array(String)}");
  });

  it("filters services and repos by IN", () => {
    const sql = buildWhereClause({
      levels: [],
      services: ["svc-a"],
      repos: ["repo-a"],
    });
    expect(sql).toContain("ServiceName IN {services:Array(String)}");
    expect(sql).toContain(
      "ResourceAttributes['vcs.repository.name'] IN {repos:Array(String)}",
    );
  });

  it("filters traceId when set", () => {
    const sql = buildWhereClause({
      traceId: "abc",
      levels: [],
      services: [],
      repos: [],
    });
    expect(sql).toContain("TraceId = {traceId:String}");
  });
});
