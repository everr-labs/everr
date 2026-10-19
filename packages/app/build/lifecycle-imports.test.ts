// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixtureDirectories: string[] = [];

function lintFixture(source: string) {
  const directory = mkdtempSync(
    resolve(repositoryRoot, "packages/app/src/components/composition-lifecycle-"),
  );
  fixtureDirectories.push(directory);
  const file = resolve(directory, "fixture.ts");
  writeFileSync(file, source);
  return spawnSync(
    resolve(repositoryRoot, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.json", file],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

afterEach(() =>
  fixtureDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

it.each([
  {
    alias: "runtime",
    source: 'import { runtime } from "@composition/runtime"; void runtime;',
  },
  {
    alias: "identity",
    source: 'import { identity } from "@composition/identity"; void identity;',
  },
])("restricts @composition/$alias to its lifecycle boundary", ({ source, alias }) => {
  const result = lintFixture(source);
  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("boundaries(dependencies)");
  expect(output).toContain(`Import @composition/${alias} only`);
});

it("allows ordinary named composition imports", () => {
  const result = lintFixture(
    'import { productClient } from "@composition/client"; void productClient;',
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
});
