// @vitest-environment node
import { Generator, getConfig } from "@tanstack/router-generator";
import {
  renameSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  appAliases,
  appDirectory,
  appRoutes,
  installationComposition,
  prepareComposition,
  type AppComposition,
} from "../vite.app";

async function generateRoutes(composition: AppComposition) {
  const config = getConfig(appRoutes(composition), appDirectory);
  await new Generator({ config, root: appDirectory }).run();
}

const roots: string[] = [];
function fixture(): AppComposition {
  const directory = mkdtempSync(resolve(tmpdir(), "application-composition-"));
  roots.push(directory);
  mkdirSync(resolve(directory, "src"));
  writeFileSync(
    resolve(directory, "src/arbitrary-name.tsx"),
    "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/example')({});",
  );
  return {
    ...installationComposition,
    directory,
    modules: {
      server: resolve(directory, "src/arbitrary-name.tsx"),
      client: resolve(directory, "src/arbitrary-name.tsx"),
      product: resolve(directory, "src/arbitrary-name.tsx"),
      navigation: resolve(directory, "src/arbitrary-name.tsx"),
      dashboards: resolve(directory, "src/arbitrary-name.tsx"),
    },
    serverEntries: undefined,
    routes: {
      signedIn: [
        {
          type: "route",
          path: "example",
          file: resolve(directory, "src/arbitrary-name.tsx"),
        },
      ],
    },
    routeTree: resolve(directory, "src/routeTree.gen.ts"),
  };
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

it("keeps URLs and parent guards when a registered source file moves", async () => {
  const composition = fixture();
  await generateRoutes(composition);
  let tree = readFileSync(composition.routeTree, "utf8");
  expect(tree).toContain("fullPath: '/example'");
  expect(tree).toContain("parentRoute: typeof routesWelcome_signedInRoute");
  const moved = resolve(composition.directory, "src/renamed.tsx");
  renameSync(composition.routes.signedIn![0].file, moved);
  composition.routes.signedIn![0].file = moved;
  for (const name of Object.keys(
    composition.modules,
  ) as (keyof typeof composition.modules)[])
    composition.modules[name] = moved;
  await generateRoutes(composition);
  tree = readFileSync(composition.routeTree, "utf8");
  expect(tree).toContain("fullPath: '/example'");
  expect(tree).toContain("./renamed");
  expect(tree).not.toContain("./arbitrary-name");
});
it("derives compiler module selection from the same entries as the bundler", () => {
  const composition = fixture();
  prepareComposition(composition);
  const generated = JSON.parse(
    readFileSync(
      resolve(composition.directory, "tsconfig.composition.json"),
      "utf8",
    ),
  );
  expect(Object.keys(generated.compilerOptions.paths).sort()).toEqual(
    ["@/*", ...appAliases(composition).map((alias) => alias.find)].sort(),
  );
  expect(generated.compilerOptions.paths["@composition/routes"]).toEqual([
    "./src/routeTree.gen.ts",
  ]);
});
it("rejects duplicate route registration", () => {
  const composition = fixture();
  composition.routes.signedIn!.push(composition.routes.signedIn![0]);
  expect(() => appRoutes(composition)).toThrow(/Duplicate registered route/);
});

it("rejects registered files from another package", () => {
  const composition = fixture();
  composition.routes.signedIn![0].file = installationComposition.modules.server;
  expect(() => appRoutes(composition)).toThrow(/must belong/);
  composition.modules.server = installationComposition.modules.server;
  expect(() => prepareComposition(composition)).toThrow(/must belong/);
});
