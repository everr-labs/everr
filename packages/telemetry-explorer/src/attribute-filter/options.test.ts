import { describe, expect, it } from "vite-plus/test";
import { memoryFilterOptionsCache } from "../testing/filter-options-cache";
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

describe("attribute options last known list", () => {
  const withValues = (values: string[]) =>
    ({
      attributeValues: async () => values,
      attributeKeys: async () => [],
    }) as unknown as AttributeRepositoryLike;
  const valuesKey = ["traces", "attributeValues", "span", "http.route"];

  it("stores an unsearched values list without the time range", async () => {
    const cache = memoryFilterOptionsCache();
    await attributeValuesOptions(
      withValues(["/a", "/b"]),
      { timeRange, source: "span", key: "http.route" },
      { domain: "traces" },
      cache,
    ).queryFn();
    expect(cache.read(valuesKey)).toEqual(["/a", "/b"]);
  });

  it("never stores or shows a searched values list", async () => {
    const cache = memoryFilterOptionsCache([[valuesKey, ["/a", "/b"]]]);
    const options = attributeValuesOptions(
      withValues(["/a"]),
      { timeRange, source: "span", key: "http.route", search: "/a" },
      { domain: "traces" },
      cache,
    );
    await options.queryFn();
    expect(cache.read(valuesKey)).toEqual(["/a", "/b"]);
    expect(options.placeholderData(undefined, undefined)).toBeUndefined();
  });

  it("shows the last known keys until the first fetch returns", () => {
    const cache = memoryFilterOptionsCache([
      [["traces", "attributeKeys"], [{ source: "span", key: "http.route" }]],
    ]);
    const options = attributeKeysOptions(repo, { timeRange }, { domain: "traces" }, cache);
    expect(options.placeholderData?.(undefined, undefined)).toEqual([
      { source: "span", key: "http.route" },
    ]);
  });
});
