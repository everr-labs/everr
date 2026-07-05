import { describe, expect, it } from "vite-plus/test";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import { ENVIRONMENT_ATTRIBUTE, splitDedicatedAttributes } from "./dedicated-attributes";

const env = (op: AttributeFilter["op"], values: string[] = []): AttributeFilter => ({
  source: "resource",
  key: "deployment.environment",
  op,
  values,
});

describe("splitDedicatedAttributes", () => {
  it("separates the dedicated 'in' entry from the rest", () => {
    const other: AttributeFilter = {
      source: "log",
      key: "code",
      op: "in",
      values: ["x"],
    };
    const { dedicated, rest } = splitDedicatedAttributes(
      [env("in", ["prod"]), other],
      [ENVIRONMENT_ATTRIBUTE],
    );
    expect(dedicated).toEqual([env("in", ["prod"])]);
    expect(rest).toEqual([other]);
  });

  it("leaves a non-'in' entry for a dedicated key in rest", () => {
    const { dedicated, rest } = splitDedicatedAttributes(
      [env("not_in", ["dev"])],
      [ENVIRONMENT_ATTRIBUTE],
    );
    expect(dedicated).toEqual([]);
    expect(rest).toEqual([env("not_in", ["dev"])]);
  });
});
