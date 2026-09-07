import { describe, expect, it } from "vitest";
import type { AttributeSource } from "../schemas";
import { buildAttributeClauses } from "./where";

const columnFor = (s: AttributeSource) =>
  ({
    resource: "ResourceAttributes",
    log: "LogAttributes",
    scope: "ScopeAttributes",
    span: "SpanAttributes",
  })[s];

describe("buildAttributeClauses", () => {
  it("builds an IN clause with indexed params", () => {
    const { clauses, params } = buildAttributeClauses(
      [
        {
          source: "resource",
          key: "deployment.environment",
          op: "in",
          values: ["prod"],
        },
      ],
      columnFor,
    );
    expect(clauses[0]).toBe(
      "has(ResourceAttributesKeys, {attrKey0:String}) AND toString(ResourceAttributes.`deployment.environment`) IN {attrVals0:Array(String)}",
    );
    expect(params).toEqual({
      attrKey0: "deployment.environment",
      attrVals0: ["prod"],
    });
  });

  it("treats not_in as present-with-a-different-value (excludes missing)", () => {
    const { clauses } = buildAttributeClauses(
      [{ source: "log", key: "http.method", op: "not_in", values: ["GET"] }],
      columnFor,
    );
    expect(clauses[0]).toBe(
      "(has(LogAttributesKeys, {attrKey0:String}) AND toString(LogAttributes.`http.method`) NOT IN {attrVals0:Array(String)})",
    );
  });

  it("emits presence-only clauses for exists and missing", () => {
    const exists = buildAttributeClauses(
      [{ source: "scope", key: "k", op: "exists", values: [] }],
      columnFor,
    );
    expect(exists.clauses[0]).toBe(
      "has(ScopeAttributesKeys, {attrKey0:String})",
    );
    expect(exists.params).toEqual({ attrKey0: "k" });

    const missing = buildAttributeClauses(
      [{ source: "span", key: "k", op: "missing", values: [] }],
      columnFor,
    );
    expect(missing.clauses[0]).toBe(
      "NOT has(SpanAttributesKeys, {attrKey0:String})",
    );
  });

  it("no-ops empty-value in/not_in (no clause, no param)", () => {
    expect(
      buildAttributeClauses(
        [{ source: "resource", key: "k", op: "in", values: [] }],
        columnFor,
      ),
    ).toEqual({ clauses: [], params: {} });
  });

  it("offsets param names by startIndex", () => {
    const { clauses, params } = buildAttributeClauses(
      [{ source: "resource", key: "k", op: "exists", values: [] }],
      columnFor,
      3,
    );
    expect(clauses[0]).toBe("has(ResourceAttributesKeys, {attrKey3:String})");
    expect(params).toEqual({ attrKey3: "k" });
  });

  it("escapes the key in the identifier and leaves the param as typed", () => {
    const { clauses, params } = buildAttributeClauses(
      [{ source: "log", key: "a`b", op: "in", values: ["x"] }],
      columnFor,
    );
    expect(clauses[0]).toBe(
      "has(LogAttributesKeys, {attrKey0:String}) AND toString(LogAttributes.`a\\`b`) IN {attrVals0:Array(String)}",
    );
    expect(params.attrKey0).toBe("a`b");
  });
});
