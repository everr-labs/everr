// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkSourceImports } from "./import-boundaries";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "application-imports-"));
  roots.push(root);
  const dependency = resolve(root, "node_modules/@everr/example");
  mkdirSync(dependency, { recursive: true });
  writeFileSync(
    resolve(dependency, "package.json"),
    JSON.stringify({
      name: "@everr/example",
      exports: { "./public": "./public.js" },
    }),
  );
  writeFileSync(resolve(dependency, "public.js"), "export const value = 1;");
  return (source: string, alias = resolve(root, "src")) =>
    checkSourceImports(root, resolve(root, "src/example.ts"), source, alias);
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

it("allows local modules and declared package exports", () => {
  expect(() =>
    fixture()(
      'import "./local"; import "@/component"; import "@everr/example/public";',
    ),
  ).not.toThrow();
});
it.each([
  'import "../../other/src/private";',
  'export * from "../../other/src/private";',
  'const module = import("../../other/src/private");',
  'type T = import("../../other/src/private").T;',
  'vi.mock("../../other/src/private");',
  'import "../node_modules/@everr/example/public.js";',
  'import "@/../../other/private";',
  'import "@composition/ui/../../private";',
  'import "@everr/example/private";',
])("rejects private module access: %s", (source) => {
  expect(() => fixture()(source)).toThrow();
});
it("rejects use of another package's local alias", () => {
  expect(() =>
    fixture()('import "@/component";', "/another-package/src"),
  ).toThrow(/private/);
});
