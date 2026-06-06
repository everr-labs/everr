import { describe, expect, it } from "vitest";
import {
  ALL_VALUE,
  extractVariableTokens,
  interpolateVariables,
  type VariableMeta,
  type VariableValues,
} from "./interpolate";

describe("interpolateVariables", () => {
  it("substitutes a single string value as an escaped SQL literal", () => {
    expect(
      interpolateVariables("SELECT * FROM logs WHERE service = $service", {
        service: "api",
      }),
    ).toBe("SELECT * FROM logs WHERE service = 'api'");
  });

  it("escapes single quotes and backslashes ClickHouse-style", () => {
    expect(interpolateVariables("$v", { v: "o'reilly" })).toBe("'o\\'reilly'");
    expect(interpolateVariables("$v", { v: "a\\b" })).toBe("'a\\\\b'");
  });

  it("supports ${name} braced syntax", () => {
    expect(
      interpolateVariables("WHERE s = ${service}", { service: "api" }),
    ).toBe("WHERE s = 'api'");
  });

  it("treats $var_suffix as one token but ${var}_suffix as token plus suffix", () => {
    const values: VariableValues = { service: "api", service_suffix: "x" };
    expect(interpolateVariables("$service_suffix", values)).toBe("'x'");
    expect(interpolateVariables("${service}_suffix", values)).toBe(
      "'api'_suffix",
    );
  });

  it("substitutes ${name:raw} verbatim without escaping", () => {
    expect(
      interpolateVariables("ORDER BY ${col:raw}", { col: "time DESC" }),
    ).toBe("ORDER BY time DESC");
  });

  it("joins array values with commas for :raw", () => {
    expect(interpolateVariables("${cols:raw}", { cols: ["a", "b"] })).toBe(
      "a,b",
    );
  });

  it("renders arrays as parenthesized escaped lists", () => {
    expect(
      interpolateVariables("env IN $env", { env: ["prod", "stag'ing"] }),
    ).toBe("env IN ('prod','stag\\'ing')");
  });

  it("renders an empty array as (NULL)", () => {
    expect(interpolateVariables("env IN $env", { env: [] })).toBe(
      "env IN (NULL)",
    );
  });

  it("expands the All sentinel to the loaded options list", () => {
    const meta: VariableMeta = { env: { options: ["prod", "staging"] } };
    expect(interpolateVariables("env IN $env", { env: ALL_VALUE }, meta)).toBe(
      "env IN ('prod','staging')",
    );
  });

  it("substitutes customAllValue raw when set, even with options loaded", () => {
    const meta: VariableMeta = {
      env: { customAllValue: "%", options: ["prod"] },
    };
    expect(
      interpolateVariables("env LIKE $env", { env: ALL_VALUE }, meta),
    ).toBe("env LIKE %");
  });

  it("expands All to (NULL) when no options are available", () => {
    expect(interpolateVariables("env IN $env", { env: ALL_VALUE }, {})).toBe(
      "env IN (NULL)",
    );
  });

  it("leaves unknown tokens untouched", () => {
    expect(interpolateVariables("SELECT {from:DateTime64}, $unknown", {})).toBe(
      "SELECT {from:DateTime64}, $unknown",
    );
  });

  it("handles adjacent tokens", () => {
    expect(interpolateVariables("${a}${b}", { a: "x", b: "y" })).toBe("'x''y'");
  });
});

describe("extractVariableTokens", () => {
  it("returns unique token names in order of first appearance", () => {
    expect(
      extractVariableTokens("WHERE a = $x AND b = ${y} AND c = ${x:raw}"),
    ).toEqual(["x", "y"]);
  });

  it("returns an empty array when there are no tokens", () => {
    expect(extractVariableTokens("SELECT 1")).toEqual([]);
  });
});
