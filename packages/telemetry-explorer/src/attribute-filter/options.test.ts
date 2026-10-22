import { describe, expect, it } from "vite-plus/test";
import { attributeKeysOptions, attributeValuesOptions } from "./options";
import type { AttributeRepositoryLike } from "./repository";

const repo = {} as AttributeRepositoryLike;
const timeRange = { from: "now-1h", to: "now" };

describe("attribute options", () => {
  it("namespaces the keys query by domain", () => {
    const opts = attributeKeysOptions(repo, { timeRange }, { domain: "traces" });
    expect(opts.queryKey).toEqual(["traces", "attributeKeys", timeRange]);
  });

  it("namespaces the values query by domain, source, key, and search", () => {
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
      "",
    ]);
  });

  it("includes the search term in the values query key", () => {
    const opts = attributeValuesOptions(
      repo,
      { timeRange, source: "span", key: "http.route", search: "/api" },
      { domain: "traces" },
    );
    expect(opts.queryKey).toEqual([
      "traces",
      "attributeValues",
      timeRange,
      "span",
      "http.route",
      "/api",
    ]);
  });
});
