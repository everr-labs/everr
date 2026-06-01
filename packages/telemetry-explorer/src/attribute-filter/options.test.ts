import { describe, expect, it } from "vitest";
import { attributeKeysOptions, attributeValuesOptions } from "./options";
import type { AttributeRepositoryLike } from "./repository";

const repo = {} as AttributeRepositoryLike;
const timeRange = { from: "now-1h", to: "now" };

describe("attribute options", () => {
  it("namespaces the keys query by domain", () => {
    const opts = attributeKeysOptions(
      repo,
      { timeRange },
      { domain: "traces" },
    );
    expect(opts.queryKey).toEqual(["traces", "attributeKeys", timeRange]);
  });

  it("namespaces the values query by domain, source, and key", () => {
    const opts = attributeValuesOptions(
      repo,
      { timeRange, source: "span", key: "http.route" },
      { domain: "traces" },
    );
    expect(opts.queryKey).toEqual([
      "traces",
      "attributeValues",
      timeRange,
      "span",
      "http.route",
    ]);
  });
});
