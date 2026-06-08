import { describe, expect, it } from "vitest";
import { ALL_VALUE } from "./interpolate";
import type { ListVariable, TextVariable, Variable } from "./schema";
import {
  buildAllMeta,
  effectiveVariableValues,
  getListVariableSource,
  pickByNames,
  sortVariableOptions,
} from "./variable-values";

function text(name: string, value: string): TextVariable {
  return { kind: "TextVariable", spec: { name, value } };
}

function list(
  name: string,
  spec: Partial<ListVariable["spec"]> = {},
): ListVariable {
  return {
    kind: "ListVariable",
    spec: {
      name,
      plugin: { kind: "StaticListVariable", spec: { values: ["a", "b"] } },
      ...spec,
    },
  };
}

describe("effectiveVariableValues", () => {
  it("URL value wins over the spec default", () => {
    const vars: Variable[] = [
      text("env", "prod"),
      list("svc", { defaultValue: "a" }),
    ];
    expect(effectiveVariableValues(vars, { env: "staging", svc: "b" })).toEqual(
      { env: "staging", svc: "b" },
    );
  });

  it("falls back to spec defaults when the URL has no value", () => {
    const vars: Variable[] = [
      text("env", "prod"),
      list("svc", { defaultValue: "a" }),
    ];
    expect(effectiveVariableValues(vars, undefined)).toEqual({
      env: "prod",
      svc: "a",
    });
  });

  it("omits variables with no effective value (no URL value, no default, empty text)", () => {
    const vars: Variable[] = [text("env", ""), list("svc")];
    expect(effectiveVariableValues(vars, undefined)).toEqual({});
  });

  it("normalizes multi-select values to arrays (URL string and string default)", () => {
    const multi = list("svc", { allowMultiple: true, defaultValue: "a" });
    expect(effectiveVariableValues([multi], { svc: "b" })).toEqual({
      svc: ["b"],
    });
    expect(effectiveVariableValues([multi], undefined)).toEqual({ svc: ["a"] });
  });

  it("keeps multi-select arrays as-is, including empty arrays", () => {
    const multi = list("svc", { allowMultiple: true });
    expect(effectiveVariableValues([multi], { svc: ["a", "b"] })).toEqual({
      svc: ["a", "b"],
    });
    expect(effectiveVariableValues([multi], { svc: [] })).toEqual({ svc: [] });
  });

  it("treats an array URL value for a single-select as invalid → default", () => {
    const single = list("svc", { defaultValue: "a" });
    expect(effectiveVariableValues([single], { svc: ["b"] })).toEqual({
      svc: "a",
    });
  });

  it("treats an array URL value for a text variable as invalid → default", () => {
    expect(
      effectiveVariableValues([text("env", "prod")], { env: ["x"] }),
    ).toEqual({
      env: "prod",
    });
  });

  it("allows the All sentinel only when allowAllValue is set", () => {
    const withAll = list("svc", { allowAllValue: true, defaultValue: "a" });
    const withoutAll = list("svc", { defaultValue: "a" });
    expect(effectiveVariableValues([withAll], { svc: ALL_VALUE })).toEqual({
      svc: ALL_VALUE,
    });
    expect(effectiveVariableValues([withoutAll], { svc: ALL_VALUE })).toEqual({
      svc: "a",
    });
  });

  it("treats arrays containing the All sentinel as invalid → default", () => {
    const multi = list("svc", {
      allowMultiple: true,
      allowAllValue: true,
      defaultValue: ["a"],
    });
    expect(effectiveVariableValues([multi], { svc: [ALL_VALUE, "b"] })).toEqual(
      {
        svc: ["a"],
      },
    );
  });

  it("treats an array default for a single-select as invalid → omitted", () => {
    const single = list("svc", { defaultValue: ["a", "b"] });
    expect(effectiveVariableValues([single], undefined)).toEqual({});
  });
});

describe("getListVariableSource", () => {
  it("reads StaticListVariable values", () => {
    expect(getListVariableSource(list("svc"))).toEqual({
      kind: "static",
      values: ["a", "b"],
    });
  });

  it("reads ClickHouseSQLVariable query", () => {
    const v = list("svc", {
      plugin: {
        kind: "ClickHouseSQLVariable",
        spec: { query: "SELECT s FROM t" },
      },
    });
    expect(getListVariableSource(v)).toEqual({
      kind: "query",
      query: "SELECT s FROM t",
    });
  });

  it("returns unknown for other plugin kinds or malformed specs", () => {
    const v = list("svc", {
      plugin: { kind: "PrometheusLabelValues", spec: {} },
    });
    expect(getListVariableSource(v)).toEqual({ kind: "unknown" });
    const malformed = list("svc", {
      plugin: { kind: "StaticListVariable", spec: {} },
    });
    expect(getListVariableSource(malformed)).toEqual({ kind: "unknown" });
  });

  it("drops non-string entries from static values", () => {
    const v = list("svc", {
      plugin: { kind: "StaticListVariable", spec: { values: ["a", 1, "b"] } },
    });
    expect(getListVariableSource(v)).toEqual({
      kind: "static",
      values: ["a", "b"],
    });
  });
});

describe("buildAllMeta", () => {
  it("uses customAllValue when set, without needing options", () => {
    const v = list("svc", { allowAllValue: true, customAllValue: "%" });
    const { meta, pendingAllNames } = buildAllMeta([v], { svc: ALL_VALUE }, {});
    expect(meta).toEqual({ svc: { customAllValue: "%" } });
    expect(pendingAllNames).toEqual([]);
  });

  it("uses loaded options when no customAllValue", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames } = buildAllMeta(
      [v],
      { svc: ALL_VALUE },
      { svc: { options: ["a", "b"] } },
    );
    expect(meta).toEqual({ svc: { options: ["a", "b"] } });
    expect(pendingAllNames).toEqual([]);
  });

  it("reports pending when All is selected but options are not loaded yet", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames } = buildAllMeta([v], { svc: ALL_VALUE }, {});
    expect(meta).toEqual({});
    expect(pendingAllNames).toEqual(["svc"]);
  });

  it("ignores variables whose value is not the All sentinel", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames } = buildAllMeta(
      [v],
      { svc: "a" },
      { svc: { options: ["a"] } },
    );
    expect(meta).toEqual({});
    expect(pendingAllNames).toEqual([]);
  });

  it("reports an error (not pending) when the options query failed", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames, allErrors } = buildAllMeta(
      [v],
      { svc: ALL_VALUE },
      { svc: { error: "boom" } },
    );
    expect(meta).toEqual({});
    expect(pendingAllNames).toEqual([]);
    expect(allErrors.svc).toBe("Failed to load options for $svc: boom");
  });

  it("reports an error when options were truncated, never expanding partial", () => {
    const v = list("svc", { allowAllValue: true });
    const { meta, pendingAllNames, allErrors } = buildAllMeta(
      [v],
      { svc: ALL_VALUE },
      { svc: { options: ["a", "b"], truncated: true } },
    );
    expect(meta).toEqual({});
    expect(pendingAllNames).toEqual([]);
    expect(allErrors.svc).toBe(
      'Variable "$svc" has too many values to expand "All"',
    );
  });
});

describe("pickByNames", () => {
  it("picks only the requested names that exist", () => {
    expect(pickByNames({ a: "1", b: "2" }, ["a", "c"])).toEqual({ a: "1" });
  });
});

describe("sortVariableOptions", () => {
  it("preserves order for undefined sort", () => {
    const opts = ["c", "a", "b"];
    expect(sortVariableOptions(opts, undefined)).toEqual(["c", "a", "b"]);
  });

  it('preserves order for sort "none"', () => {
    const opts = ["c", "a", "b"];
    expect(sortVariableOptions(opts, "none")).toEqual(["c", "a", "b"]);
  });

  it("does not mutate the input array", () => {
    const opts = ["c", "a", "b"];
    const original = [...opts];
    sortVariableOptions(opts, "alphabetical-asc");
    expect(opts).toEqual(original);
  });

  it("sorts alphabetical-asc (case-sensitive)", () => {
    expect(sortVariableOptions(["b", "A", "c"], "alphabetical-asc")).toEqual([
      "A",
      "b",
      "c",
    ]);
  });

  it("sorts alphabetical-desc (case-sensitive)", () => {
    expect(sortVariableOptions(["b", "A", "c"], "alphabetical-desc")).toEqual([
      "c",
      "b",
      "A",
    ]);
  });

  it("sorts alphabetical-ci-asc (case-insensitive)", () => {
    expect(sortVariableOptions(["b", "A", "c"], "alphabetical-ci-asc")).toEqual(
      ["A", "b", "c"],
    );
  });

  it("sorts alphabetical-ci-desc (case-insensitive)", () => {
    expect(
      sortVariableOptions(["b", "A", "c"], "alphabetical-ci-desc"),
    ).toEqual(["c", "b", "A"]);
  });

  it("sorts numerical-asc", () => {
    expect(sortVariableOptions(["10", "2", "1"], "numerical-asc")).toEqual([
      "1",
      "2",
      "10",
    ]);
  });

  it("sorts numerical-desc", () => {
    expect(sortVariableOptions(["10", "2", "1"], "numerical-desc")).toEqual([
      "10",
      "2",
      "1",
    ]);
  });

  it("pushes non-numeric values to end for numerical-asc", () => {
    expect(
      sortVariableOptions(["foo", "10", "bar", "2"], "numerical-asc"),
    ).toEqual(["2", "10", "foo", "bar"]);
  });

  it("pushes non-numeric values to end for numerical-desc", () => {
    expect(
      sortVariableOptions(["foo", "10", "bar", "2"], "numerical-desc"),
    ).toEqual(["10", "2", "foo", "bar"]);
  });
});
