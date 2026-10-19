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

function lintFixture(source: string, directoryPath = "packages/app/src/components", filename = "fixture.ts") {
  const directory = mkdtempSync(
    resolve(repositoryRoot, directoryPath, "composition-lifecycle-"),
  );
  fixtureDirectories.push(directory);
  const file = resolve(directory, filename);
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
    name: "runtime lifecycle imports",
    source: 'import { runtime } from "@composition/runtime"; void runtime;',
    message: "Import @composition/runtime only",
  },
  {
    name: "identity lifecycle imports",
    source: 'import { identity } from "@composition/identity"; void identity;',
    message: "Import @composition/identity only",
  },
  {
    name: "server implementations in browser composition",
    source: 'import { storage } from "@composition/storage"; void storage;',
    directory: "packages/cloud/src/app/composition",
    filename: "pages.tsx",
    message: "Browser composition must use client-safe features",
  },
  {
    name: "provider types in identity policy",
    source: 'import type { GenericEndpointContext } from "better-auth"; export type Context = GenericEndpointContext;',
    directory: "packages/app/src/app",
    filename: "identity-policy.server.ts",
    message: "Identity policy uses application facts",
  },
  {
    name: "database coordination in cloud request handlers",
    source: 'import { db } from "@everr/app/db/client"; void db;',
    directory: "packages/cloud/src/data",
    message: "Cloud request handlers call owned workflows",
  },
  {
    name: "provider internals outside identity",
    source: 'import { membershipMutationPlugin } from "#app/identity/membership.ts"; void membershipMutationPlugin;',
    message: "Authentication provider internals belong to the identity module",
  },
  {
    name: "production instances in the identity constructor",
    source: 'import { db } from "#app/db/client.ts"; void db;',
    directory: "packages/app/src/identity",
    filename: "module.ts",
    message: "Construct identity and request locks with explicit dependencies",
  },
  {
    name: "environment access in installation identity policy",
    source: 'import { env } from "#app/env/index.ts"; void env;',
    directory: "packages/app/src/app",
    filename: "identity-policy.ts",
    message: "Construct identity and request locks with explicit dependencies",
  },
  {
    name: "identity construction in browser composition",
    source: 'import { createApplicationAuth } from "@everr/app/identity/module"; void createApplicationAuth;',
    directory: "packages/cloud/src/app/composition",
    filename: "layouts.tsx",
    message: "Browser composition must use client-safe features",
  },
])("rejects $name", ({ source, directory, filename, message }) => {
  const result = lintFixture(source, directory, filename);
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain(message);
});

it.each([
  {
    name: "ordinary named composition imports",
    source: 'import { productClient } from "@composition/client"; void productClient;',
  },
  {
    name: "server-function interfaces in browser pages",
    source: 'import { getActiveOrgPolicy } from "@everr/app/data/product"; void getActiveOrgPolicy;',
    directory: "packages/cloud/src/app/composition",
    filename: "pages.tsx",
  },
])("allows $name", ({ source, directory, filename }) => {
  const result = lintFixture(source, directory, filename);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
});
