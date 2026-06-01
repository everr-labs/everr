import { describe, expect, it } from "vitest";
import { buildWhereClause } from "./where";

describe("buildWhereClause", () => {
  it("starts with the time-range bounds", () => {
    const { clause } = buildWhereClause({ levels: [], services: [] });
    expect(clause).toContain(
      "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    );
    expect(clause).toContain(
      "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
    );
  });

  it("adds positionCaseInsensitive when query is set", () => {
    const { clause } = buildWhereClause({
      query: "boom",
      levels: [],
      services: [],
    });
    expect(clause).toContain(
      "positionCaseInsensitive(Body, {query:String}) > 0",
    );
  });

  it("filters levels when present and includeLevels is not false", () => {
    const { clause } = buildWhereClause({ levels: ["error"], services: [] });
    expect(clause).toContain("IN {levels:Array(String)}");
  });

  it("omits the levels filter when includeLevels is false", () => {
    const { clause } = buildWhereClause({
      levels: ["error"],
      services: [],
      includeLevels: false,
    });
    expect(clause).not.toContain("{levels:Array(String)}");
  });

  it("filters services by IN", () => {
    const { clause } = buildWhereClause({ levels: [], services: ["svc-a"] });
    expect(clause).toContain("ServiceName IN {services:Array(String)}");
  });

  it("builds an IN attribute clause with indexed params", () => {
    const { clause, params } = buildWhereClause({
      levels: [],
      services: [],
      attributes: [
        {
          source: "resource",
          key: "deployment.environment",
          op: "in",
          values: ["prod"],
        },
      ],
    });
    expect(clause).toContain(
      "mapContains(ResourceAttributes, {attrKey0:String})",
    );
    expect(clause).toContain(
      "ResourceAttributes[{attrKey0:String}] IN {attrVals0:Array(String)}",
    );
    expect(params).toEqual({
      attrKey0: "deployment.environment",
      attrVals0: ["prod"],
    });
  });

  it("builds a NOT IN attribute clause that includes logs missing the key", () => {
    const { clause } = buildWhereClause({
      levels: [],
      services: [],
      attributes: [
        { source: "log", key: "http.method", op: "not_in", values: ["GET"] },
      ],
    });
    expect(clause).toContain(
      "(NOT mapContains(LogAttributes, {attrKey0:String}) OR LogAttributes[{attrKey0:String}] NOT IN {attrVals0:Array(String)})",
    );
  });

  it("builds exists and missing clauses without value params", () => {
    const exists = buildWhereClause({
      levels: [],
      services: [],
      attributes: [{ source: "scope", key: "lib", op: "exists", values: [] }],
    });
    expect(exists.clause).toContain(
      "mapContains(ScopeAttributes, {attrKey0:String})",
    );
    expect(exists.params).toEqual({ attrKey0: "lib" });

    const missing = buildWhereClause({
      levels: [],
      services: [],
      attributes: [
        { source: "resource", key: "host.name", op: "missing", values: [] },
      ],
    });
    expect(missing.clause).toContain(
      "NOT mapContains(ResourceAttributes, {attrKey0:String})",
    );
  });

  it("indexes multiple attribute filters independently", () => {
    const { params } = buildWhereClause({
      levels: [],
      services: [],
      attributes: [
        { source: "resource", key: "a", op: "in", values: ["1"] },
        { source: "log", key: "b", op: "exists", values: [] },
      ],
    });
    expect(params).toEqual({ attrKey0: "a", attrVals0: ["1"], attrKey1: "b" });
  });

  it("filters traceId when set", () => {
    const { clause } = buildWhereClause({
      traceId: "abc",
      levels: [],
      services: [],
    });
    expect(clause).toContain("TraceId = {traceId:String}");
  });
});
