import { expect, it } from "vite-plus/test";
import { assembleBuiltinCatalog } from "./assemble";

const first = { id: "first", name: "First" };
const second = { id: "second", name: "Second" };

it("orders documents by the manifest without losing their contents", () => {
  const document = { ...first, document: { panels: ["panel"] } };
  const result = assembleBuiltinCatalog([second, first], [document, second]);
  expect(result).toEqual([second, document]);
  expect(result[1]).toBe(document);
});

it.each([
  [[first], [], "Missing built-in dashboard: first"],
  [[], [first], "Built-in dashboards missing from manifest: first"],
  [[first], [first, first], "Duplicate built-in dashboard: first"],
  [[first, first], [first], "Duplicate built-in manifest entry: first"],
  [
    [first],
    [{ ...first, name: "Different" }],
    "Built-in dashboard name differs from manifest: first",
  ],
] as const)("rejects inconsistent catalog identities (%j, %j)", (manifest, documents, error) => {
  expect(() => assembleBuiltinCatalog(manifest, documents)).toThrow(error);
});
